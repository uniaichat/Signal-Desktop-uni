// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  WebContentsView,
} from 'electron';

import { ProfileManager } from './ProfileManager.node.ts';
import type { ProfileRuntime } from './ProfileManager.node.ts';

const DEFAULT_SHELL_SIDEBAR_WIDTH = 210;
const MIN_SHELL_SIDEBAR_WIDTH = 160;
const MAX_SHELL_SIDEBAR_WIDTH = 360;

// Controller 不知道 Signal 后端如何初始化；shell.main.ts 通过该回调注入。
// 这样 View 管理和 SQL/配置启动逻辑可以分别维护。
export type StartProfile = (
  runtime: ProfileRuntime,
  view: WebContentsView
) => Promise<void>;

export class ProfileShellController {
  // Controller 连接两层：上层是 React 管理壳的创建/激活/删除 IPC，
  // 下层是 ProfileManager 和 Electron WebContentsView。它还负责当前可见 View
  // 的挂载、尺寸、焦点以及删除前的用户确认。
  readonly #rootDir: string;
  readonly #shellWindow: BrowserWindow;
  readonly #startProfile: StartProfile;
  readonly #onProfileRemoved?: (profileId: string) => void;
  readonly #manager: ProfileManager;

  #activeView?: WebContentsView;
  #sidebarWidth = DEFAULT_SHELL_SIDEBAR_WIDTH;
  // undefined 表示管理壳还没有通过 customerDetail 完成用户身份绑定。
  #currentCustomerId?: string;

  public constructor({
    rootDir,
    shellDataPath,
    shellWindow,
    startProfile,
    onProfileRemoved,
  }: {
    rootDir: string;
    shellDataPath: string;
    shellWindow: BrowserWindow;
    startProfile: StartProfile;
    onProfileRemoved?: (profileId: string) => void;
  }) {
    this.#rootDir = rootDir;
    this.#shellWindow = shellWindow;
    this.#startProfile = startProfile;
    this.#onProfileRemoved = onProfileRemoved;
    this.#manager = new ProfileManager({
      shellDataPath,
      viewFactory: runtime => this.#createView(runtime),
    });

    this.#shellWindow.on('resize', () => this.#resizeActiveView());
    // WebContentsView 不是 BrowserWindow，窗口焦点事件需要管理壳显式转发。
    this.#shellWindow.on('focus', () => {
      this.#activeView?.webContents.send('set-window-focus', true);
    });
    this.#shellWindow.on('blur', () => {
      this.#activeView?.webContents.send('set-window-focus', false);
    });
  }

  public get manager(): ProfileManager {
    return this.#manager;
  }

  public installIpc(): void {
    // 以下三个 channel 只能由 shell.html 调用，Signal Profile renderer 无权创建账号。
    const requireShellSender = (senderId: number): void => {
      if (senderId !== this.#shellWindow.webContents.id) {
        throw new Error('Signal shell IPC called by an untrusted renderer');
      }
    };

    ipcMain.handle('uni:shell:bind-customer', async (event, customerId) => {
      requireShellSender(event.sender.id);
      const normalizedCustomerId = normalizeCustomerId(customerId);

      if (this.#currentCustomerId !== normalizedCustomerId) {
        // token 已切换为另一个 unichat 用户。旧用户 View 可以继续保留运行时，
        // 但必须立即从主窗口移除，不能继续显示或被新用户操作。
        if (this.#activeView) {
          this.#shellWindow.contentView.removeChildView(this.#activeView);
          this.#activeView.webContents.send('set-window-focus', false);
          this.#activeView = undefined;
        }
        this.#currentCustomerId = normalizedCustomerId;
      }

      return this.#manager.list(normalizedCustomerId);
    });

    ipcMain.handle('uni:shell:list-profiles', event => {
      requireShellSender(event.sender.id);
      return this.#manager.list(this.#requireCustomerId());
    });

    ipcMain.on('uni:shell:set-sidebar-width', (event, width) => {
      requireShellSender(event.sender.id);
      if (typeof width !== 'number' || !Number.isFinite(width)) {
        return;
      }
      this.#sidebarWidth = Math.max(
        MIN_SHELL_SIDEBAR_WIDTH,
        Math.min(MAX_SHELL_SIDEBAR_WIDTH, Math.round(width))
      );
      this.#resizeActiveView();
    });

    ipcMain.handle('uni:shell:create-profile', (event, input) => {
      requireShellSender(event.sender.id);
      return this.#manager.create({
        ...input,
        customerId: this.#requireCustomerId(),
      });
    });

    ipcMain.handle('uni:shell:rename-profile', (event, id, name) => {
      requireShellSender(event.sender.id);
      return this.#manager.rename(this.#requireCustomerId(), id, name);
    });

    ipcMain.handle('uni:shell:reorder-profiles', (event, orderedIds) => {
      requireShellSender(event.sender.id);
      if (!Array.isArray(orderedIds)) {
        throw new Error('Invalid Profile order');
      }
      return this.#manager.reorder(this.#requireCustomerId(), orderedIds);
    });

    ipcMain.handle('uni:shell:activate-profile', async (event, id) => {
      requireShellSender(event.sender.id);
      await this.activate(id);
    });

    ipcMain.handle('uni:shell:delete-profile', async (event, id) => {
      requireShellSender(event.sender.id);
      const customerId = this.#requireCustomerId();
      const profile = (await this.#manager.list(customerId)).find(
        item => item.metadata.id === id
      );
      if (!profile) {
        return false;
      }

      const result = await dialog.showMessageBox(this.#shellWindow, {
        type: 'warning',
        title: '删除 Signal 账号',
        message: `确定要删除“${profile.metadata.name}”吗？`,
        detail:
          '该账号的数据库、附件、日志、配置及浏览器会话数据都会被永久删除，此操作无法撤销。',
        buttons: ['取消', '删除'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1) {
        return false;
      }

      await this.#deleteProfile(customerId, id);
      this.#onProfileRemoved?.(id);
      return true;
    });
  }

  public async loadShell(): Promise<void> {
    // shell.html 必须同时存在于 electron-builder 的 files 白名单中。
    await this.#shellWindow.loadFile(
      join(this.#rootDir, 'app', 'uni', 'shell', 'shell.html')
    );
  }

  public clearCustomerBinding(): void {
    // 新协议 token 到达后，在 customerDetail 完成前进入“无用户”状态。
    // 这样切换窗口期间任何 create/activate/delete IPC 都会被拒绝。
    if (this.#activeView) {
      this.#shellWindow.contentView.removeChildView(this.#activeView);
      this.#activeView.webContents.send('set-window-focus', false);
      this.#activeView = undefined;
    }
    this.#currentCustomerId = undefined;
  }

  public async activate(id: string): Promise<void> {
    // Manager.activate 保证 Runtime 已经就绪；#show 只处理可见性。
    // 已启动 Profile 切换回来时不会重建 SQL/session/View。
    // Manager 负责“按需启动且只启动一次”，Controller 只负责把 View 挂到窗口。
    const runtime = await this.#manager.activate(this.#requireCustomerId(), id);
    this.#show(runtime.view);
  }

  public async activateAndSend(
    id: string,
    channel: string,
    ...args: ReadonlyArray<unknown>
  ): Promise<void> {
    const runtime = await this.#manager.activate(this.#requireCustomerId(), id);
    this.#show(runtime.view);
    runtime.view?.webContents.send(channel, ...args);
  }

  async #createView(runtime: ProfileRuntime): Promise<WebContentsView> {
    // persist partition 隔离 Cookie、Cache、IndexedDB 等 Chromium 数据。
    const profileSession = session.fromPartition(runtime.partition);
    const view = new WebContentsView({
      webPreferences: {
        session: profileSession,
        preload: join(this.#rootDir, 'bundles', 'preload', 'wrapper.js'),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: false,
        spellcheck: false,
        additionalArguments: [`--signal-profile-id=${runtime.metadata.id}`],
      },
    });
    view.webContents.on(
      'console-message',
      (_event, level, message, line, sourceId) => {
        // oxlint-disable-next-line no-console
        console.log('[SignalProfile renderer]', {
          profileId: runtime.metadata.id,
          level,
          message,
          line,
          sourceId,
        });
      }
    );
    view.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL) => {
        // oxlint-disable-next-line no-console
        console.error('[SignalProfile did-fail-load]', {
          profileId: runtime.metadata.id,
          errorCode,
          errorDescription,
          validatedURL,
        });
      }
    );
    this.#manager.registerView(runtime, view);

    try {
      // 必须先注册 sender 路由，再加载 background.html；Signal preload 会在页面
      // 初始化早期通过同步 IPC 请求 get-config、locale-data 等信息。
      await this.#startProfile(runtime, view);
      return view;
    } catch (error) {
      this.#manager.unregisterView(view);
      view.webContents.close();
      throw error;
    }
  }

  async #deleteProfile(customerId: string, id: string): Promise<void> {
    await this.#manager.remove(customerId, id, async runtime => {
      const partition = runtime?.partition ?? `persist:signal-profile-${id}`;
      const profileSession =
        runtime?.view?.webContents.session ?? session.fromPartition(partition);
      const storagePath = profileSession.storagePath;
      if (runtime?.view) {
        if (this.#activeView === runtime.view) {
          this.#shellWindow.contentView.removeChildView(runtime.view);
          this.#activeView = undefined;
        }
        this.#manager.unregisterView(runtime.view);
        if (!runtime.view.webContents.isDestroyed()) {
          const destroyed = new Promise<void>(resolveDestroyed => {
            runtime.view?.webContents.once('destroyed', resolveDestroyed);
          });
          // 删除已经由用户二次确认，不允许页面 beforeunload 阻止资源回收。
          runtime.view.webContents.close({ waitForBeforeUnload: false });
          await destroyed;
        }
      }

      // renderer 已停止后再关闭 SQL，避免页面退出过程中继续产生数据库请求。
      await runtime?.sql?.close();

      // 清理 Chromium 在全局 userData/Partitions 下保存的 Cookie、缓存和 IndexedDB。
      // clearStorageData 后仍可能留下空目录，因此最后还会删除准确的 storagePath。
      await profileSession.clearCache();
      await profileSession.clearStorageData();
      profileSession.flushStorageData();
      await profileSession.closeAllConnections();
      // Electron keeps persistent partition files (notably SharedStorage) open
      // for the lifetime of the process on Windows. clearStorageData above
      // removes the account data; deleting the remaining partition directory
      // here would intermittently fail with EBUSY. A newly created Profile gets
      // a new id and therefore never reuses this cleared partition.
      if (process.platform !== 'win32') {
        await removeSessionStorageDirectory(storagePath, id);
      }
    });
  }

  #show(view: WebContentsView | undefined): void {
    if (!view || view.webContents.isDestroyed()) {
      return;
    }

    if (this.#activeView && this.#activeView !== view) {
      // removeChildView 只是从窗口视图树隐藏旧账号，并不会销毁其 renderer。
      // 因此后台连接保持运行，重新点击 Tab 可以立即显示。
      // 标签切换只把旧 View 从视图树移除，不销毁它；账号保持在线，切回无需重启。
      this.#activeView.webContents.send('set-window-focus', false);
      this.#shellWindow.contentView.removeChildView(this.#activeView);
    }
    this.#activeView = view;
    this.#shellWindow.contentView.addChildView(view);
    this.#resizeActiveView();
    view.webContents.focus();
    view.webContents.send('set-window-focus', this.#shellWindow.isFocused());
    view.webContents.send('activate');
    // Signal 未注册流程会等待 activate 后才调用 installer.startInstaller()；
    // 漏掉该事件会一直停留在 Signal Logo，无法显示二维码。
    view.webContents.send('set-media-playback-disabled', false);
  }

  #resizeActiveView(): void {
    if (!this.#activeView || this.#activeView.webContents.isDestroyed()) {
      return;
    }
    const [width = 0, height = 0] = this.#shellWindow.getContentSize();
    this.#activeView.setBounds({
      // 左侧 260px 留给 React 管理栏，其余区域全部交给 Signal。
      x: this.#sidebarWidth,
      y: 0,
      width: Math.max(0, width - this.#sidebarWidth),
      height,
    });
  }

  #requireCustomerId(): string {
    if (!this.#currentCustomerId) {
      throw new Error('Unichat user information has not been loaded');
    }
    return this.#currentCustomerId;
  }
}

function normalizeCustomerId(value: unknown): string {
  const customerId = String(value ?? '').trim();
  if (!/^\d{1,32}$/.test(customerId)) {
    throw new Error('Invalid unichat customerId');
  }
  return customerId;
}

async function removeSessionStorageDirectory(
  storagePath: string | null,
  profileId: string
): Promise<void> {
  if (!storagePath) {
    return;
  }

  const expectedName = `signal-profile-${profileId}`;
  const resolvedPath = resolve(storagePath);
  // 这是最后一道安全边界：只允许删除当前 persist partition 的精确目录。
  if (basename(resolvedPath) !== expectedName) {
    throw new Error(`Unexpected Signal profile session path: ${resolvedPath}`);
  }
  await rm(resolvedPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
