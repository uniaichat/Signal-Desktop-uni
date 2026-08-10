// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto';

import { app, ipcMain } from 'electron';
import { Notifier } from '@indutny/simple-windows-notifications';

import type { ProfileManager } from './ProfileManager.node.ts';
import type { ProfileId } from './ProfileTypes.std.ts';
import type { WindowsNotificationData } from '../../../ts/services/notifications.preload.ts';
import { parseSignalRoute } from '../../../ts/util/signalRoutes.std.ts';
import OS from '../../../ts/util/os/osMain.node.ts';
import { renderWindowsToast } from '../../renderWindowsToast.std.tsx';
import { AUMID } from '../../startup_config.main.ts';
import { createLogger } from '../../../ts/logging/log.std.ts';

const log = createLogger('ProfileNotificationRouter');

export type ProfileNotificationState = Readonly<{
  profileId: ProfileId;
  unreadCount: number;
}>;

type NotificationTarget = Readonly<{
  profileId: ProfileId;
  rendererToken: string;
}>;

export class ProfileNotificationRouter {
  readonly #manager: ProfileManager;
  readonly #onStateChanged: (
    state: ReadonlyArray<ProfileNotificationState>
  ) => void;
  readonly #activateAndSend: (
    profileId: ProfileId,
    channel: string,
    ...args: ReadonlyArray<unknown>
  ) => Promise<void>;
  readonly #unreadCounts = new Map<ProfileId, number>();
  readonly #notificationTargets = new Map<string, NotificationTarget>();
  readonly #notifier = OS.isWindows() ? new Notifier(AUMID) : undefined;

  public constructor({
    manager,
    onStateChanged,
    activateAndSend,
  }: {
    manager: ProfileManager;
    onStateChanged(state: ReadonlyArray<ProfileNotificationState>): void;
    activateAndSend(
      profileId: ProfileId,
      channel: string,
      ...args: ReadonlyArray<unknown>
    ): Promise<void>;
  }) {
    this.#manager = manager;
    this.#onStateChanged = onStateChanged;
    this.#activateAndSend = activateAndSend;
  }

  public installIpc(): void {
    ipcMain.on('set-badge', (event, badge: number | 'marked-unread') => {
      this.#setUnreadCount(
        event.sender.id,
        badge === 'marked-unread' ? 1 : badge
      );
    });
    ipcMain.on('update-tray-icon', (event, unreadCount: number) => {
      this.#setUnreadCount(event.sender.id, unreadCount);
    });
    ipcMain.on('draw-attention', event => {
      if (this.#manager.getProfileIdForSender(event.sender.id)) {
        app.focus({ steal: true });
      }
    });
    ipcMain.on('show-window', event => {
      const profileId = this.#manager.getProfileIdForSender(event.sender.id);
      if (profileId) {
        void this.#activateAndSend(profileId, 'show-window');
      }
    });

    ipcMain.handle(
      'windows-notifications:show',
      (event, data: WindowsNotificationData) => {
        const profileId = this.#manager.getProfileIdForSender(event.sender.id);
        if (!profileId || !this.#notifier) {
          return;
        }

        this.#removeTargetsForProfile(profileId);
        const shellToken = randomUUID();
        this.#notificationTargets.set(shellToken, {
          profileId,
          rendererToken: data.token,
        });
        try {
          this.#notifier.show(
            renderWindowsToast({ ...data, token: shellToken }),
            notificationId(profileId)
          );
        } catch (error) {
          this.#notificationTargets.delete(shellToken);
          log.error(`Failed to show notification for ${profileId}`, error);
        }
      }
    );
    ipcMain.handle('windows-notifications:clear-all', event => {
      const profileId = this.#manager.getProfileIdForSender(event.sender.id);
      if (profileId && this.#notifier) {
        try {
          this.#notifier.remove(notificationId(profileId));
        } catch (error) {
          log.error(`Failed to clear notifications for ${profileId}`, error);
        }
        this.#removeTargetsForProfile(profileId);
      }
    });
  }

  public get state(): ReadonlyArray<ProfileNotificationState> {
    return Array.from(this.#unreadCounts, ([profileId, unreadCount]) => ({
      profileId,
      unreadCount,
    }));
  }

  public async handleUrl(rawUrl: string): Promise<boolean> {
    const route = parseSignalRoute(rawUrl);
    if (!route || route.key !== 'showConversation') {
      return false;
    }
    const target = this.#notificationTargets.get(route.args.token);
    if (!target) {
      return false;
    }

    this.#notificationTargets.delete(route.args.token);
    await this.#activateAndSend(
      target.profileId,
      'show-conversation-via-token',
      target.rendererToken
    );
    return true;
  }

  public removeProfile(profileId: ProfileId): void {
    this.#unreadCounts.delete(profileId);
    this.#removeTargetsForProfile(profileId);
    try {
      this.#notifier?.remove(notificationId(profileId));
    } catch (error) {
      log.error(`Failed to remove notifications for ${profileId}`, error);
    }
    this.#publishState();
  }

  #setUnreadCount(senderId: number, value: number): void {
    const profileId = this.#manager.getProfileIdForSender(senderId);
    if (!profileId || !Number.isFinite(value)) {
      return;
    }
    this.#unreadCounts.set(profileId, Math.max(0, Math.trunc(value)));
    this.#publishState();
  }

  #publishState(): void {
    const state = this.state;
    const total = state.reduce((sum, item) => sum + item.unreadCount, 0);
    app.setBadgeCount(total);
    this.#onStateChanged(state);
  }

  #removeTargetsForProfile(profileId: ProfileId): void {
    for (const [token, target] of this.#notificationTargets) {
      if (target.profileId === profileId) {
        this.#notificationTargets.delete(token);
      }
    }
  }
}

function notificationId(profileId: ProfileId): { group: string; tag: string } {
  return { group: 'signal-profile', tag: profileId };
}
