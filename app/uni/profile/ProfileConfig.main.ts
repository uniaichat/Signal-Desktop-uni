// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { app, safeStorage } from 'electron';

import { start } from '../../base_config.node.ts';

export type ProfileConfig = ReturnType<typeof start>;

// 长期配置：SQL 密钥、账号相关设置等，位于 Profile 自己的 config.json。
export function createProfileConfig(profilePath: string): ProfileConfig {
  return start({
    name: `profile:${profilePath}`,
    targetPath: join(profilePath, 'config.json'),
    throwOnFilesystemErrors: true,
  });
}

export function createProfileEphemeralConfig(
  profilePath: string
): ProfileConfig {
  // 界面主题、缩放等可恢复但非核心的数据单独放在 ephemeral.json。
  return start({
    name: `profile-ephemeral:${profilePath}`,
    targetPath: join(profilePath, 'ephemeral.json'),
    throwOnFilesystemErrors: false,
  });
}

export function getOrCreateProfileSqlKey(config: ProfileConfig): string {
  // 安装包优先读取 safeStorage 加密后的密钥。
  const encryptedKey = config.get('encryptedKey');
  if (typeof encryptedKey === 'string') {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System encryption is unavailable for this profile');
    }
    return safeStorage.decryptString(Buffer.from(encryptedKey, 'hex'));
  }

  const legacyKey = config.get('key');
  if (typeof legacyKey === 'string') {
    persistSqlKey(config, legacyKey);
    return legacyKey;
  }

  const key = randomBytes(32).toString('hex');
  persistSqlKey(config, key);
  return key;
}

function persistSqlKey(config: ProfileConfig, key: string): void {
  // 开发模式保留明文是为了避免某些开发机 safeStorage 不可用；生产包必须尽量加密。
  const canEncrypt = app.isPackaged && safeStorage.isEncryptionAvailable();
  if (canEncrypt) {
    config.set('encryptedKey', safeStorage.encryptString(key).toString('hex'));
    config.set('key', undefined);
  } else {
    config.set('key', key);
  }
}
