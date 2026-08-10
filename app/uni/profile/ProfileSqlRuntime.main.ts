// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { app } from 'electron';

import { createLogger } from '../../../ts/logging/log.std.ts';
import { MainSQL } from '../../../ts/sql/main.main.ts';
import {
  createProfileConfig,
  createProfileEphemeralConfig,
  getOrCreateProfileSqlKey,
} from './ProfileConfig.main.ts';
import type { ProfileConfig } from './ProfileConfig.main.ts';

const log = createLogger('ProfileSqlRuntime');

export type ProfileBackend = Readonly<{
  sql: MainSQL;
  config: ProfileConfig;
  ephemeralConfig: ProfileConfig;
}>;

// 一个 Profile 对应一个独立 MainSQL 实例和一套配置文件。
// 这里传入的 configDir 是 Profile 目录，不能退回全局 app.getPath('userData')。
export async function initializeProfileBackend(
  profilePath: string
): Promise<ProfileBackend> {
  const config = createProfileConfig(profilePath);
  const ephemeralConfig = createProfileEphemeralConfig(profilePath);
  const key = getOrCreateProfileSqlKey(config);
  const sql = new MainSQL();
  await sql.initialize({
    appVersion: app.getVersion(),
    configDir: profilePath,
    key,
    logger: log,
  });
  return { sql, config, ephemeralConfig };
}
