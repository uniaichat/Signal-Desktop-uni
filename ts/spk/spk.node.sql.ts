import SQL, { Database } from '@signalapp/sqlcipher';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export class TranslationCache {
  private static instance: TranslationCache | null = null;
  private db: Database;

  private constructor(dbPath: string, key: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new SQL(dbPath);
    this.db.pragma(`key = '${key}'`);
    this.db.initTokenizer();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        key TEXT PRIMARY KEY,
        rawText TEXT,
        toLang TEXT,
        translation TEXT,
        timestamp INTEGER
      )
    `);
  }

  static getInstance(dbPath?: string, key?: string) {
    if (!TranslationCache.instance) {
      if (!dbPath) dbPath = path.join(app.getPath('userData'), 'translateCacheDb', 'translations.db');
      if (!key) key = 'default-secret-key';

      // 尝试打开，如果损坏则删除文件
      if (fs.existsSync(dbPath)) {
        try {
          const testDb = new SQL(dbPath);
          testDb.pragma(`key = '${key}'`);
          testDb.initTokenizer();
          testDb.close();
        } catch (err) {
          console.warn('[TranslationCache] Database invalid, recreating...', err);
          try {
            fs.unlinkSync(dbPath);
          } catch (_) { /* 文件可能被锁，忽略 */ }
        }
      }

      TranslationCache.instance = new TranslationCache(dbPath, key);

      // 注册退出自动关闭
      const safeClose = () => {
        try {
          TranslationCache.instance?.close();
        } catch (_) { }
      };
      app.on('quit', safeClose);
      process.on('exit', safeClose);
      process.on('SIGINT', safeClose);
      process.on('SIGTERM', safeClose);
    }
    return TranslationCache.instance;
  }

  private makeKey(rawText: string, toLang: string) {
    return `${toLang}:${rawText}`;
  }

  set(rawText: string, toLang: string, translation: string) {
    const key = this.makeKey(rawText, toLang);
    const timestamp = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO translation_cache
      (key, rawText, toLang, translation, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run([key, rawText, toLang, translation, timestamp]);
    return Promise.resolve(true)
  }

  get(rawText: string, toLang: string): Promise<string|null> {
    const key = this.makeKey(rawText, toLang);
    const row = this.db.prepare(`
      SELECT translation FROM translation_cache WHERE key = ?
    `).get([key]);
    
    const res = row ? (row.translation as string) : null;
    if (res) {
        const now = Date.now();
        // 2. 更新当前条目的 timestamp
        this.db.prepare(`
        UPDATE translation_cache SET timestamp = ? WHERE key = ?
        `).run([now, key]);
        }
        return Promise.resolve(res)
  }

  cleanOlderThan(days: number) {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    this.db.prepare(`DELETE FROM translation_cache WHERE timestamp < ?`).run([cutoff]);
  }

  close() {
    this.db.close();
    TranslationCache.instance = null;
  }
}
