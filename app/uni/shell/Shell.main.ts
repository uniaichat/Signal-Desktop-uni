// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  ipcMain,
  protocol as electronProtocol,
  session,
} from 'electron';

import { AssetService } from '../../AssetService.main.ts';
import { EmojiService } from '../../EmojiService.main.ts';
import { OptionalResourceService } from '../../OptionalResourceService.main.ts';
import { ProfileShellController } from '../profile/ProfileShellController.main.ts';
import { initializeProfileBackend } from '../profile/ProfileSqlRuntime.main.ts';
import { installProfileRendererIpc } from '../profile/ProfileRendererIpc.main.ts';
import { ProfileNotificationRouter } from '../profile/ProfileNotificationRouter.main.ts';
import { installProfileSqlChannel } from '../profile/ProfileSqlChannel.main.ts';
import { installUniIpc } from '../UniIpc.main.ts';
import { SharedTranslationCache } from '../SharedTranslationCache.main.ts';
import {
  findUnichatRoute,
  parseUnichatRoute,
  UnichatContext,
} from '../UnichatContext.main.ts';
import type { UnichatRoute } from '../UnichatContext.main.ts';
import { getAppRootDir } from '../../../ts/util/appRootDir.main.ts';
import {
  installFileHandler,
  installWebHandler,
} from '../../protocol_filter.node.ts';
import OS from '../../../ts/util/os/osMain.node.ts';
import { packageJson } from '../../../ts/util/packageJson.main.ts';
import { createLogger } from '../../../ts/logging/log.std.ts';

const log = createLogger('Shell');

const rootDir = getAppRootDir();
const shellDataPath = join(app.getPath('userData'), 'shell');
const shellWindowIcon =
  process.platform === 'win32'
    ? join(rootDir, 'build', 'icons', 'win', 'icon.ico')
    : join(rootDir, 'build', 'icons', 'png', '512x512.png');
// UnichatContext 是唯一主进程级登录上下文。所有 Profile 共用它，但 renderer
// 只能看到 brand/isAuthenticated，不能读取内部 token。
const unichatContext = new UnichatContext();
// 冷启动协议位于 process.argv；先解析并暂存，窗口和 IPC 安装完成后再应用。
const initialUnichatRoute = findUnichatRoute(process.argv);

let shellWindow: BrowserWindow | undefined;
let shellController: ProfileShellController | undefined;
let notificationRouter: ProfileNotificationRouter | undefined;

// 自定义协议必须在 app ready 前注册。
electronProtocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { corsEnabled: true } },
  {
    scheme: 'attachment',
    privileges: {
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Do this before taking the single-instance lock. During an install/update an
// older instance may still be running, but this process should still repair
// the URL association before it exits.
if (process.platform === 'win32') {
  const protocol = 'unisignal';
  const registered = app.setAsDefaultProtocolClient(
    protocol,
    process.execPath
  );
  const isDefault = app.isDefaultProtocolClient(protocol, process.execPath);

  if (!registered || !isDefault) {
    log.error('Failed to register custom URL protocol', {
      protocol,
      registered,
      isDefault,
      execPath: process.execPath,
    });
  } else {
    log.info('Custom URL protocol is registered', {
      protocol,
      execPath: process.execPath,
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows/Linux 再次通过协议唤起时，参数由第二实例转交到唯一主进程。
  app.on('second-instance', (_event, argv) => {
    showShell();
    const notificationUrl = findNotificationUrl(argv);
    if (notificationUrl && notificationRouter) {
      void notificationRouter.handleUrl(notificationUrl);
      return;
    }
    const route = findUnichatRoute(argv);
    if (route) {
      applyUnichatRoute(route);
    }
  });

  // macOS 自定义协议通过 open-url 进入。
  app.on('open-url', (event, url) => {
    event.preventDefault();
    showShell();
    if (notificationRouter) {
      void handleShellUrl(url);
      return;
    }
    const route = parseUnichatRoute(url);
    if (route) {
      applyUnichatRoute(route);
    }
  });

  app.whenReady().then(async () => {
    const proxyUrl = await resolveSystemProxyUrl();
    if (proxyUrl && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
      process.env.HTTPS_PROXY = proxyUrl;
    }

    const resourceService = OptionalResourceService.create(
      join(shellDataPath, 'optionalResources')
    );
    const assetService = AssetService.create(resourceService);
    const emojiService = await EmojiService.create(resourceService);

    // 所有 Signal Profile 共用一个翻译缓存数据库。
    const translationCache = new SharedTranslationCache(
      join(shellDataPath, 'translation-cache', 'translations.db'),
      'AxVsd1sF53sdBCd'
    );
    app.once('will-quit', () => translationCache.close());

    // BrowserWindow 只渲染 React 管理壳，Signal 本体由 WebContentsView 承载。
    shellWindow = new BrowserWindow({
      show: false,
      width: 1180,
      height: 760,
      minWidth: 720,
      minHeight: 520,
    autoHideMenuBar: true,
      title: getShellWindowTitle(),
      icon: shellWindowIcon,
      backgroundColor: '#f6f6f6',
      webPreferences: {
        preload: join(rootDir, 'bundles', 'preload', 'shell.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    shellWindow.webContents.on('page-title-updated', event => {
      event.preventDefault();
      shellWindow?.setTitle(getShellWindowTitle());
    });

    shellController = new ProfileShellController({
      rootDir,
      shellDataPath,
      shellWindow,
      startProfile: async (runtime, view) => {
        // Profile 首次激活：独立 SQL/config -> 独立 session 协议 -> Signal 页面。
        const backend = await initializeProfileBackend(runtime.profilePath);
        runtime.sql = backend.sql;
        runtime.config = backend.config;
        runtime.ephemeralConfig = backend.ephemeralConfig;
        assetService.install(view.webContents.session.protocol);
        emojiService.install(view.webContents.session.protocol);
        installFileHandler({
          session: view.webContents.session,
          userDataPath: runtime.profilePath,
          installPath: rootDir,
          isWindows: OS.isWindows(),
        });
        installWebHandler({
          session: view.webContents.session,
          enableHttp: false,
        });
        await view.webContents.loadFile(join(rootDir, 'background.html'));
      },
      onProfileRemoved: profileId =>
        notificationRouter?.removeProfile(profileId),
    });

    notificationRouter = new ProfileNotificationRouter({
      manager: shellController.manager,
      onStateChanged: state => {
        if (shellWindow && !shellWindow.isDestroyed()) {
          shellWindow.webContents.send(
            'uni:shell:notification-state-changed',
            state
          );
        }
      },
      activateAndSend: async (profileId, channel, ...args) => {
        showShell();
        await shellController?.activateAndSend(profileId, channel, ...args);
        shellWindow?.webContents.send('uni:shell:profile-activated', profileId);
      },
    });
    notificationRouter.installIpc();
    ipcMain.handle('uni:shell:get-notification-state', event => {
      if (event.sender.id !== shellWindow?.webContents.id) {
        throw new Error('Untrusted notification state request');
      }
      return notificationRouter?.state ?? [];
    });

    await installProfileRendererIpc({
      manager: shellController.manager,
      proxyUrl,
      rootDir,
    });
    await installUniIpc({
      context: unichatContext,
      manager: shellController.manager,
      proxyUrl,
      translationCache,
      // uni-fetch 需要同时服务管理壳和 Profile。通过 webContents.id 精确识别
      // 管理壳，不能仅凭 IPC channel 名称信任调用者。
      isShellSender: senderId => senderId === shellWindow?.webContents.id,
    });
    installShellUnichatIpc();

    // 原 Signal SQL channel 名保持不变，后端改为 sender -> Profile SQL。
    installProfileSqlChannel(
      senderId => shellController?.manager.getSqlForSender(senderId),
      senderId => shellController?.manager.eraseConfigForSender(senderId)
    );
    shellController.installIpc();

    // 冷启动只展示管理壳，不自动启动任何 Signal Profile。
    await shellController.loadShell();
    shellWindow.show();

    if (initialUnichatRoute) {
      applyUnichatRoute(initialUnichatRoute);
    }
    const initialNotificationUrl = findNotificationUrl(process.argv);
    if (initialNotificationUrl) {
      await notificationRouter.handleUrl(initialNotificationUrl);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

async function handleShellUrl(url: string): Promise<void> {
  if (await notificationRouter?.handleUrl(url)) {
    return;
  }
  const route = parseUnichatRoute(url);
  if (route) {
    applyUnichatRoute(route);
  }
}

function findNotificationUrl(argv: ReadonlyArray<string>): string | undefined {
  return argv.find(arg => arg.startsWith('sgnl://show-conversation'));
}

function installShellUnichatIpc(): void {
  // invoke/handle 用于 React 挂载后的“读取当前快照”。即使协议事件早于
  // React listener 注册，管理壳仍能通过这个接口补读到最新状态。
  ipcMain.handle('uni:shell:get-unichat-context', event => {
    if (event.sender.id !== shellWindow?.webContents.id) {
      throw new Error('Untrusted unichat context request');
    }
    return unichatContext.snapshot;
  });

  // EventEmitter -> webContents.send 用于“推送后续快照”。例如主程序已运行时，
  // unichat 再次唤起第二实例，新的协议参数会由 second-instance 进入这里。
  unichatContext.on('change', snapshot => {
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.setTitle(getShellWindowTitle(snapshot.brand));
      shellWindow.webContents.send(
        'uni:shell:unichat-context-changed',
        snapshot
      );
    }
  });
}

function getShellWindowTitle(
  brand: string = unichatContext.snapshot.brand
): string {
  return `${brand}-signal ${packageJson.version}`;
}

function applyUnichatRoute(route: UnichatRoute): void {
  // token 可能属于另一个 customer。先撤销旧用户授权并隐藏旧 View，等 React
  // 查询 customerDetail 后再通过 bind-customer 建立新用户边界。
  shellController?.clearCustomerBinding();
  // 主进程只保存协议凭据并广播非敏感快照；用户资料由 React 自己请求和展示。
  unichatContext.applyRoute(route);
}

async function resolveSystemProxyUrl(): Promise<string | undefined> {
  const configuredProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (configuredProxy) {
    return configuredProxy;
  }

  const proxyRules = await session.defaultSession.resolveProxy(
    'https://chat.signal.org'
  );
  for (const rule of proxyRules.split(';')) {
    const [type, address] = rule.trim().split(/\s+/, 2);
    if (!type || !address) {
      continue;
    }
    switch (type.toUpperCase()) {
      case 'PROXY':
        return `http://${address}`;
      case 'HTTPS':
        return `https://${address}`;
      case 'SOCKS':
      case 'SOCKS5':
        return `socks5://${address}`;
      case 'SOCKS4':
        return `socks4://${address}`;
      default:
        break;
    }
  }
  return undefined;
}

function showShell(): void {
  if (!shellWindow || shellWindow.isDestroyed()) {
    return;
  }
  if (shellWindow.isMinimized()) {
    shellWindow.restore();
  }
  shellWindow.show();
  shellWindow.focus();
}
