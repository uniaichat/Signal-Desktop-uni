// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcMain } from 'electron';

import type { MainSQL } from '../../../ts/sql/main.main.ts';

export type ProfileSqlChannelTarget = Pick<
  MainSQL,
  | 'sqlReadSerialized'
  | 'sqlWriteSerialized'
  | 'pauseWriteAccess'
  | 'resumeWriteAccess'
  | 'removeDB'
>;

type SqlResolver = (senderId: number) => ProfileSqlChannelTarget | undefined;
type EraseConfig = (senderId: number) => void;

const SQL_READ_KEY = 'sql-channel:read';
const SQL_WRITE_KEY = 'sql-channel:write';
const SQL_REMOVE_DB_KEY = 'sql-channel:remove-db';
const ERASE_SQL_KEY = 'erase-sql-key';
const PAUSE_WRITE_ACCESS = 'pause-sql-writes';
const RESUME_WRITE_ACCESS = 'resume-sql-writes';

function wrapResult<Params extends Array<unknown>, T>(
  fn: (...params: Params) => Promise<T>
): (
  ...params: Params
) => Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  return async function wrappedIpcSqlMethod(...params) {
    try {
      return { ok: true, value: await fn(...params) };
    } catch (error) {
      return { ok: false, error };
    }
  };
}

export function installProfileSqlChannel(
  resolveSql: SqlResolver,
  eraseConfig: EraseConfig
): void {
  function getSql(senderId: number, channel: string): ProfileSqlChannelTarget {
    const sql = resolveSql(senderId);
    if (!sql) {
      throw new Error(
        `${channel}: No Profile SQL runtime for sender ${senderId}`
      );
    }
    return sql;
  }

  ipcMain.handle(
    SQL_READ_KEY,
    wrapResult(function profileSqlRead(event, callName, serialized) {
      return getSql(event.sender.id, SQL_READ_KEY).sqlReadSerialized(
        callName,
        serialized
      );
    })
  );
  ipcMain.handle(
    SQL_WRITE_KEY,
    wrapResult(function profileSqlWrite(event, callName, serialized) {
      return getSql(event.sender.id, SQL_WRITE_KEY).sqlWriteSerialized(
        callName,
        serialized
      );
    })
  );
  ipcMain.handle(SQL_REMOVE_DB_KEY, event =>
    getSql(event.sender.id, SQL_REMOVE_DB_KEY).removeDB()
  );
  ipcMain.handle(ERASE_SQL_KEY, event => eraseConfig(event.sender.id));
  ipcMain.handle(PAUSE_WRITE_ACCESS, event =>
    getSql(event.sender.id, PAUSE_WRITE_ACCESS).pauseWriteAccess()
  );
  ipcMain.handle(RESUME_WRITE_ACCESS, event =>
    getSql(event.sender.id, RESUME_WRITE_ACCESS).resumeWriteAccess()
  );
}
