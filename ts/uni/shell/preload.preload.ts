// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { contextBridge, ipcRenderer } from 'electron';

import type { ProfileSnapshot } from '../../../app/uni/profile/ProfileTypes.std.ts';
import type { ProfileNotificationState } from '../../../app/uni/profile/ProfileNotificationRouter.main.ts';
import type { UnichatContextSnapshot } from '../../../app/uni/UnichatContext.main.ts';

export type SignalShellApi = Readonly<{
  // customerDetail 成功后先绑定当前用户。主进程从此只允许操作该用户的 Profile。
  bindCustomer(customerId: string): Promise<ReadonlyArray<ProfileSnapshot>>;
  // 读取主进程保存的 Profile 元数据和当前运行状态。
  listProfiles(): Promise<ReadonlyArray<ProfileSnapshot>>;
  // 创建只写入元数据；真正的 Signal Runtime 在 activateProfile 时按需启动。
  createProfile(input: { id: string; name: string }): Promise<ProfileSnapshot>;
  renameProfile(id: string, name: string): Promise<ProfileSnapshot>;
  reorderProfiles(
    orderedIds: ReadonlyArray<string>
  ): Promise<ReadonlyArray<ProfileSnapshot>>;
  activateProfile(id: string): Promise<void>;
  deleteProfile(id: string): Promise<boolean>;
  // 一次性读取协议上下文，供管理壳初始化使用。
  getUnichatContext(): Promise<UnichatContextSnapshot>;
  // 订阅后续协议唤起产生的 token/brand 变化，返回值用于取消订阅。
  onUnichatContextChanged(
    listener: (snapshot: UnichatContextSnapshot) => void
  ): () => void;
  getNotificationState(): Promise<ReadonlyArray<ProfileNotificationState>>;
  onNotificationStateChanged(
    listener: (state: ReadonlyArray<ProfileNotificationState>) => void
  ): () => void;
  onProfileActivated(listener: (profileId: string) => void): () => void;
}>;

// shell.html 开启了 contextIsolation 和 sandbox，只暴露管理壳实际需要的三个能力。
// 不要把 ipcRenderer 本身或任意 invoke(channel) 暴露给 DOM。
const api: SignalShellApi = {
  bindCustomer: customerId =>
    ipcRenderer.invoke('uni:shell:bind-customer', customerId),
  listProfiles: () => ipcRenderer.invoke('uni:shell:list-profiles'),
  createProfile: input => ipcRenderer.invoke('uni:shell:create-profile', input),
  renameProfile: (id, name) =>
    ipcRenderer.invoke('uni:shell:rename-profile', id, name),
  reorderProfiles: orderedIds =>
    ipcRenderer.invoke('uni:shell:reorder-profiles', orderedIds),
  activateProfile: id => ipcRenderer.invoke('uni:shell:activate-profile', id),
  deleteProfile: id => ipcRenderer.invoke('uni:shell:delete-profile', id),
  getUnichatContext: () => ipcRenderer.invoke('uni:shell:get-unichat-context'),
  onUnichatContextChanged: listener => {
    // ipcRenderer 的原始回调包含 Electron event。DOM 层不需要它，因此 preload
    // 只把经过类型收窄的 snapshot 交给 React。
    const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
      listener(snapshot as UnichatContextSnapshot);
    };
    ipcRenderer.on('uni:shell:unichat-context-changed', handler);
    return () => {
      // 必须使用同一个 handler 引用才能正确移除该监听器。
      ipcRenderer.removeListener('uni:shell:unichat-context-changed', handler);
    };
  },
  getNotificationState: () =>
    ipcRenderer.invoke('uni:shell:get-notification-state'),
  onNotificationStateChanged: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      listener(state as ReadonlyArray<ProfileNotificationState>);
    };
    ipcRenderer.on('uni:shell:notification-state-changed', handler);
    return () => {
      ipcRenderer.removeListener(
        'uni:shell:notification-state-changed',
        handler
      );
    };
  },
  onProfileActivated: listener => {
    const handler = (_event: Electron.IpcRendererEvent, profileId: unknown) => {
      if (typeof profileId === 'string') {
        listener(profileId);
      }
    };
    ipcRenderer.on('uni:shell:profile-activated', handler);
    return () => {
      ipcRenderer.removeListener('uni:shell:profile-activated', handler);
    };
  },
};

contextBridge.exposeInMainWorld('SignalShell', api);

// Only expose request forwarding to the shell. Main injects the secret token.
contextBridge.exposeInMainWorld('uniIpc', {
  fetch: (payload: unknown) => ipcRenderer.invoke('uni-fetch', payload),
});
