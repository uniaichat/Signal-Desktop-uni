// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { WebContentsView } from 'electron';

import type { ProfileSqlChannelTarget } from './ProfileSqlChannel.main.ts';
import type { MainSQL } from '../../../ts/sql/main.main.ts';
import type { ProfileConfig } from './ProfileConfig.main.ts';
import { ProfileMetadataStore } from './ProfileMetadataStore.node.ts';
import type {
  ProfileId,
  ProfileMetadata,
  ProfileRuntimeState,
  ProfileSnapshot,
} from './ProfileTypes.std.ts';

export type ProfileRuntime = {
  // metadata/profilePath/partition 决定该账号的持久化隔离边界。
  metadata: ProfileMetadata;
  readonly profilePath: string;
  readonly partition: string;
  state: ProfileRuntimeState;
  view?: WebContentsView;
  sql?: MainSQL;
  config?: ProfileConfig;
  ephemeralConfig?: ProfileConfig;
};

export type ProfileViewFactory = (
  runtime: ProfileRuntime
) => Promise<WebContentsView>;

export type ProfileCleanup = (
  runtime: ProfileRuntime | undefined
) => Promise<void>;

export class ProfileManager {
  // ProfileManager 只负责“账号运行时生命周期和路由”，不负责把 View 摆到窗口：
  // - MetadataStore：持久化已创建账号列表；
  // - runtimes：保存本次进程中已经启动的 SQL/config/session/View；
  // - senderProfiles：把每个 IPC sender 定位到正确 Profile；
  // - activation/removalPromises：合并同一账号的并发启动或删除操作。
  readonly #profilesPath: string;
  readonly #store: ProfileMetadataStore;
  readonly #viewFactory: ProfileViewFactory;
  readonly #runtimes = new Map<ProfileId, ProfileRuntime>();
  // Signal 现有 IPC channel 大多没有 profileId 参数，所以统一通过
  // event.sender.id -> profileId 找回正确的 SQL、配置和账号上下文。
  readonly #senderProfiles = new Map<number, ProfileId>();
  // 防止同一标签被快速点击多次时重复创建 SQL 和 WebContentsView。
  readonly #activationPromises = new Map<ProfileId, Promise<ProfileRuntime>>();
  readonly #removalPromises = new Map<ProfileId, Promise<void>>();

  public constructor({
    shellDataPath,
    viewFactory,
  }: {
    shellDataPath: string;
    viewFactory: ProfileViewFactory;
  }) {
    this.#profilesPath = join(shellDataPath, 'profiles');
    this.#store = new ProfileMetadataStore(shellDataPath);
    this.#viewFactory = viewFactory;
  }

  public async list(
    customerId: string
  ): Promise<ReadonlyArray<ProfileSnapshot>> {
    // profiles.json 只是“已创建账号列表”；未启动的账号不会创建后端资源。
    const profiles = (await this.#store.list()).filter(
      metadata => metadata.customerId === customerId
    ) as ReadonlyArray<ProfileMetadata>;
    return profiles.map(metadata => ({
      metadata,
      state: this.#runtimes.get(metadata.id)?.state ?? 'stopped',
    }));
  }

  public async create({
    id,
    name,
    customerId,
  }: {
    id: ProfileId;
    name: string;
    customerId: string;
  }): Promise<ProfileSnapshot> {
    const normalizedId = normalizeProfileId(id);
    const normalizedName = name.trim() || normalizedId;
    const existing = await this.#store.get(normalizedId);
    if (existing) {
      if (existing.customerId !== customerId) {
        throw new Error('Signal Profile belongs to another unichat user');
      }
      return {
        metadata: { ...existing, customerId },
        state: this.#runtimes.get(normalizedId)?.state ?? 'stopped',
      };
    }

    const now = Date.now();
    const metadata: ProfileMetadata = {
      id: normalizedId,
      customerId,
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(this.getProfilePath(normalizedId), { recursive: true });
    // 创建操作只落元数据和目录，不启动 Signal。真正初始化发生在 activate()。
    await this.#store.upsert(metadata);
    return { metadata, state: 'stopped' };
  }

  public async activate(
    customerId: string,
    id: ProfileId
  ): Promise<ProfileRuntime> {
    const normalizedId = normalizeProfileId(id);
    const pending = this.#activationPromises.get(normalizedId);
    if (pending) {
      // 连续点击同一个 Tab 时复用同一个启动 Promise，避免创建两套 View/SQL。
      return pending;
    }

    const activation = this.#activate(customerId, normalizedId);
    this.#activationPromises.set(normalizedId, activation);
    try {
      return await activation;
    } finally {
      this.#activationPromises.delete(normalizedId);
    }
  }

  public async rename(
    customerId: string,
    id: ProfileId,
    name: string
  ): Promise<ProfileSnapshot> {
    const normalizedId = normalizeProfileId(id);
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new Error(
        'Signal Profile name must be between 1 and 80 characters'
      );
    }
    const stored = await this.#store.get(normalizedId);
    if (!stored || stored.customerId !== customerId) {
      throw new Error('Unknown Signal Profile');
    }
    const metadata: ProfileMetadata = {
      ...stored,
      customerId,
      name: normalizedName,
      updatedAt: Date.now(),
    };
    await this.#store.upsert(metadata);
    const runtime = this.#runtimes.get(normalizedId);
    if (runtime) {
      runtime.metadata = metadata;
    }
    return { metadata, state: runtime?.state ?? 'stopped' };
  }

  public async reorder(
    customerId: string,
    orderedIds: ReadonlyArray<ProfileId>
  ): Promise<ReadonlyArray<ProfileSnapshot>> {
    const normalizedIds = orderedIds.map(normalizeProfileId);
    await this.#store.reorderCustomer(customerId, normalizedIds);
    return this.list(customerId);
  }

  public async remove(
    customerId: string,
    id: ProfileId,
    cleanup: ProfileCleanup
  ): Promise<void> {
    const normalizedId = normalizeProfileId(id);
    const pendingRemoval = this.#removalPromises.get(normalizedId);
    if (pendingRemoval) {
      return pendingRemoval;
    }

    const removal = this.#remove(customerId, normalizedId, cleanup);
    this.#removalPromises.set(normalizedId, removal);
    try {
      await removal;
    } finally {
      this.#removalPromises.delete(normalizedId);
    }
  }

  async #remove(
    customerId: string,
    normalizedId: ProfileId,
    cleanup: ProfileCleanup
  ): Promise<void> {
    // 如果 Profile 正在启动，先等启动流程收敛，再统一关闭其资源。
    try {
      await this.#activationPromises.get(normalizedId);
    } catch {
      // 启动失败的 Profile 仍应允许用户删除。
    }

    const stored = await this.#store.get(normalizedId);
    if (!stored) {
      return;
    }
    if (stored.customerId !== customerId) {
      throw new Error('Signal Profile belongs to another unichat user');
    }

    const runtime = this.#runtimes.get(normalizedId);
    if (runtime) {
      runtime.state = 'stopping';
    }
    await cleanup(runtime);

    // Profile 目录包含 config、SQL、附件和日志。先完成资源关闭，最后整体删除。
    await rm(this.getProfilePath(normalizedId), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    await this.#store.remove(normalizedId);
    this.#runtimes.delete(normalizedId);
    for (const [senderId, profileId] of this.#senderProfiles) {
      if (profileId === normalizedId) {
        this.#senderProfiles.delete(senderId);
      }
    }
  }

  async #activate(
    customerId: string,
    normalizedId: ProfileId
  ): Promise<ProfileRuntime> {
    let runtime = this.#runtimes.get(normalizedId);
    if (runtime?.state === 'running') {
      if (runtime.metadata.customerId !== customerId) {
        throw new Error('Signal Profile belongs to another unichat user');
      }
      return runtime;
    }

    const stored = await this.#store.get(normalizedId);
    if (!stored) {
      throw new Error(`Unknown Signal profile: ${normalizedId}`);
    }
    if (stored.customerId !== customerId) {
      throw new Error('Signal Profile belongs to another unichat user');
    }

    const metadata: ProfileMetadata = {
      ...stored,
      customerId,
      updatedAt: Date.now(),
      lastActivatedAt: Date.now(),
    };
    await this.#store.upsert(metadata);

    runtime = {
      metadata,
      profilePath: this.getProfilePath(normalizedId),
      partition: `persist:signal-profile-${normalizedId}`,
      state: 'starting',
    };
    this.#runtimes.set(normalizedId, runtime);

    try {
      // viewFactory 由 ProfileShellController 提供；它会依次创建 session、
      // WebContentsView、SQL/config 后端，并加载真实 background.html。
      runtime.view = await this.#viewFactory(runtime);
      runtime.state = 'running';
      const senderId = runtime.view.webContents.id;
      this.#senderProfiles.set(senderId, normalizedId);
      runtime.view.webContents.once('destroyed', () => {
        // renderer 销毁后必须清掉 sender 路由，否则 IPC 可能误投到旧账号。
        this.#senderProfiles.delete(senderId);
        this.#runtimes.delete(normalizedId);
      });
      return runtime;
    } catch (error) {
      runtime.state = 'failed';
      throw error;
    }
  }

  public getProfileIdForSender(senderId: number): ProfileId | undefined {
    return this.#senderProfiles.get(senderId);
  }

  public getRuntimeForSender(senderId: number): ProfileRuntime | undefined {
    // Signal 原有 IPC 大多没有 profileId，因此以 Electron 自动分配且唯一的
    // webContents.id 作为路由键，找到调用者所属的 Runtime。
    const profileId = this.getProfileIdForSender(senderId);
    return profileId ? this.#runtimes.get(profileId) : undefined;
  }

  public getSqlForSender(
    senderId: number
  ): ProfileSqlChannelTarget | undefined {
    const profileId = this.getProfileIdForSender(senderId);
    if (!profileId) {
      return undefined;
    }
    return this.#runtimes.get(profileId)?.sql;
  }

  public eraseConfigForSender(senderId: number): void {
    const profileId = this.getProfileIdForSender(senderId);
    const runtime = profileId ? this.#runtimes.get(profileId) : undefined;
    if (!runtime?.config || !runtime.ephemeralConfig) {
      throw new Error(`No config runtime for sender ${senderId}`);
    }
    runtime.config.remove();
    runtime.ephemeralConfig.remove();
  }

  public registerView(runtime: ProfileRuntime, view: WebContentsView): void {
    // 在 loadFile 之前注册，使 preload 最早发出的同步 IPC 也能找到 Profile。
    runtime.view = view;
    this.#senderProfiles.set(view.webContents.id, runtime.metadata.id);
  }

  public unregisterView(view: WebContentsView): void {
    this.#senderProfiles.delete(view.webContents.id);
  }

  public getProfilePath(id: ProfileId): string {
    // 每个 Profile 的 SQL、附件、日志和 config 都应以这个目录为根。
    return join(this.#profilesPath, normalizeProfileId(id));
  }
}

function normalizeProfileId(id: ProfileId): ProfileId {
  // ProfileId 会进入目录名和 Electron partition，必须禁止路径分隔符等字符。
  const normalized = id.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error('Profile id contains unsupported characters');
  }
  return normalized;
}
