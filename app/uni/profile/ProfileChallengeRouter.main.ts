// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcMain, shell, type WebContentsView } from 'electron';

import type { IPCRequest, IPCResponse } from '../../../ts/challenge.dom.ts';
import { createLogger } from '../../../ts/logging/log.std.ts';
import type { ProfileManager } from './ProfileManager.node.ts';

const log = createLogger('ProfileChallengeRouter');
const UNICHAT_OPEN_PROTOCOL = 'unisignalopen:';
const UNICHAT_RETURN_PROTOCOL = 'unisgnl:';
const PROFILE_PARAM = 'windowId';

type PendingRequest = Readonly<{
  profileId: string;
  request: IPCRequest;
}>;

export type ProfileChallengeReturn = Readonly<{
  profileId: string;
  captcha: string;
}>;

/** Routes Signal captcha pages through UniChat and returns the result to the
 * exact Profile renderer which requested it. */
export class ProfileChallengeRouter {
  readonly #manager: ProfileManager;
  readonly #activateProfile: (profileId: string) => Promise<void>;
  readonly #pending = new Map<number, Array<PendingRequest>>();

  public constructor(
    manager: ProfileManager,
    activateProfile: (profileId: string) => Promise<void>
  ) {
    this.#manager = manager;
    this.#activateProfile = activateProfile;
  }

  public installIpc(): void {
    ipcMain.on('challenge:request', (event, request: IPCRequest) => {
      const profileId = this.#manager.getProfileIdForSender(event.sender.id);
      if (!profileId || !isChallengeRequest(request)) {
        log.warn('Ignoring challenge request from unknown Profile renderer');
        return;
      }
      const requests = this.#pending.get(event.sender.id) ?? [];
      requests.push({ profileId, request });
      this.#pending.set(event.sender.id, requests);
    });
  }

  public attachView(profileId: string, view: WebContentsView): void {
    const senderId = view.webContents.id;
    view.webContents.on('will-navigate', (event, target) => {
      if (!target.toLowerCase().startsWith(`${UNICHAT_OPEN_PROTOCOL}//`)) {
        return;
      }
      event.preventDefault();
      void shell.openExternal(target).catch(error => {
        log.error(`Failed to open UniChat captcha for ${profileId}`, error);
      });
    });
    view.webContents.once('destroyed', () => {
      this.#pending.delete(senderId);
    });
  }

  public async handleUrl(rawUrl: string): Promise<boolean> {
    const result = parseProfileChallengeReturn(rawUrl);
    if (!result) {
      return false;
    }

    let delivered = 0;
    for (const [senderId, requests] of this.#pending) {
      const matching = requests.filter(
        item => item.profileId === result.profileId
      );
      if (matching.length === 0) {
        continue;
      }
      const runtime = this.#manager.getRuntimeForSender(senderId);
      const contents = runtime?.view?.webContents;
      if (!contents || contents.isDestroyed()) {
        this.#pending.delete(senderId);
        continue;
      }
      for (const { request } of matching) {
        const response: IPCResponse = {
          seq: request.seq,
          data: { captcha: result.captcha },
        };
        contents.send('challenge:response', response);
        delivered += 1;
      }
      this.#pending.delete(senderId);
    }
    log.info(
      `Delivered captcha to ${delivered} request(s) for ${result.profileId}`
    );
    try {
      await this.#activateProfile(result.profileId);
    } catch (error) {
      // The response has already reached the requesting renderer. A stale login
      // context must not make the captcha itself fail.
      log.error(
        `Failed to activate captcha Profile ${result.profileId}`,
        error
      );
    }
    return true;
  }
}

export function parseProfileChallengeReturn(
  rawUrl: string
): ProfileChallengeReturn | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== UNICHAT_RETURN_PROTOCOL) {
      return undefined;
    }
    const profileId = url.searchParams.get(PROFILE_PARAM);
    const target = url.searchParams.get('targeturl');
    if (!profileId || !target) {
      return undefined;
    }
    const captchaUrl = new URL(target);
    if (captchaUrl.protocol !== 'signalcaptcha:') {
      return undefined;
    }
    const captcha = `${captchaUrl.hostname}${captchaUrl.pathname}`.replace(
      /\/$/,
      ''
    );
    return captcha ? { profileId, captcha } : undefined;
  } catch {
    return undefined;
  }
}

function isChallengeRequest(value: IPCRequest): boolean {
  return (
    typeof value === 'object' &&
    value != null &&
    Number.isSafeInteger(value.seq) &&
    typeof value.reason === 'string'
  );
}
