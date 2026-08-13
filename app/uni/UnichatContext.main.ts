// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { EventEmitter } from 'node:events';

export type UnichatRoute = Readonly<{
  token: string;
  brand?: string;
}>;

// Only non-sensitive protocol state crosses into the shell renderer.
export type UnichatContextSnapshot = Readonly<{
  brand: string;
  isAuthenticated: boolean;
}>;

export class UnichatContext extends EventEmitter {
  #token?: string;
  #brand = 'Unichat';

  public get token(): string | undefined {
    return this.#token;
  }

  public get snapshot(): UnichatContextSnapshot {
    console.log('this.#token----------', this.#token);
    return {
      brand: this.#brand,
      isAuthenticated: Boolean(this.#token),
    };
  }

  // All Signal profiles in this authenticated shell share translation cache.
  public get cacheOwner(): string {
    return 'current-user';
  }

  public applyRoute(route: UnichatRoute): void {
    // token 只保存在主进程内存中。snapshot 和 IPC 返回值都不会包含它。
    this.#token = route.token;
    // this.#token =
    //   'eyJhbGciOiJIUzUxMiJ9.eyJsb2dpbl91c2VyX2tleSI6ImJhNWVkMDc4LWE2N2UtNDA0OS1iNjA2LTcyZTM2YWY3ZTRiMyJ9.rwDB3AdaJE9R0Ga1W-OQkIly0jYY2eRTPzDoPnjgiID19XBk48kZM4bEL31tDoXUjE0qS6W9_jdt53Bd88xRbg';
    // this.#brand = 'AiGo';
    if (route.brand?.trim()) {
      this.#brand = route.brand.trim();
    }
    // 通知 shell.main.ts 将新的非敏感快照广播给管理壳 renderer。
    this.emit('change', this.snapshot);
  }
}

export function parseUnichatRoute(input: string): UnichatRoute | undefined {
  // 当前只接受：unisignal://open?token=...&brand=...
  // token 必填、brand 可选；Profile 操作只允许管理壳内部 IPC 发起。
  if (!input.startsWith('unisignal://')) {
    return undefined;
  }
  try {
    const url = new URL(input);
    if (url.hostname !== 'open') {
      return undefined;
    }
    const token = url.searchParams.get('token');
    if (!token) {
      return undefined;
    }
    return {
      token,
      brand: url.searchParams.get('brand') || undefined,
    };
  } catch {
    return undefined;
  }
}

export function findUnichatRoute(
  argv: ReadonlyArray<string>
): UnichatRoute | undefined {
  return argv.map(parseUnichatRoute).find(route => route !== undefined);
}
