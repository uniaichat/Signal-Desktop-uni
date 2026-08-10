// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import SQL, { type Database } from '@signalapp/sqlcipher';

export type TranslationCacheKey = Readonly<{
  owner: string;
  text: string;
  to: string;
  from?: string;
  channel?: string;
}>;

export class SharedTranslationCache {
  readonly #db: Database;

  public constructor(dbPath: string, key: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#db = new SQL(dbPath);
    this.#db.pragma(`key = '${key}'`);
    this.#db.initTokenizer();
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        key TEXT PRIMARY KEY,
        rawText TEXT,
        toLang TEXT,
        translation TEXT,
        timestamp INTEGER
      )
    `);
    this.cleanOlderThan(30);
  }

  public get(input: TranslationCacheKey): string | null {
    const key = makeKey(input);
    const row = this.#db
      .prepare('SELECT translation FROM translation_cache WHERE key = ?')
      .get([key]) as { translation?: string } | undefined;
    if (!row?.translation) {
      return null;
    }
    this.#db
      .prepare('UPDATE translation_cache SET timestamp = ? WHERE key = ?')
      .run([Date.now(), key]);
    return row.translation;
  }

  public set(input: TranslationCacheKey, translation: string): void {
    this.#db
      .prepare(
        `
        INSERT OR REPLACE INTO translation_cache
          (key, rawText, toLang, translation, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run([makeKey(input), input.text, input.to, translation, Date.now()]);
  }

  public cleanOlderThan(days: number): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    this.#db
      .prepare('DELETE FROM translation_cache WHERE timestamp < ?')
      .run([cutoff]);
  }

  public close(): void {
    this.#db.close();
  }
}

function makeKey(input: TranslationCacheKey): string {
  return JSON.stringify([
    input.owner,
    input.from ?? '',
    input.to,
    input.channel ?? '',
    input.text,
  ]);
}
