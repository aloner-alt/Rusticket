/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
/* KV methods return promises to match the Worker API while SQLite operations are synchronous. */
/* eslint-disable @typescript-eslint/require-await */
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';

export interface SnapshotEntry {
  key: string;
  value: string;
  expiration?: number;
  metadata?: unknown;
}

export interface KvSnapshot {
  complete: boolean;
  namespaceId: string;
  entries: SnapshotEntry[];
}

interface KeyRow { key: string; expiration: number | null; metadata: string | null }
interface ValueRow { value: string; expiration: number | null }

export class SqliteKV {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY COLLATE BINARY,
      value TEXT NOT NULL,
      expiration INTEGER,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS kv_expiration ON kv(expiration);
    CREATE TABLE IF NOT EXISTS migration (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  close(): void { this.db.close(); }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private purge(): void {
    this.db.prepare('DELETE FROM kv WHERE expiration IS NOT NULL AND expiration <= ?')
      .run(Math.floor(Date.now() / 1000));
  }

  migration(): { namespaceId: string; count: number } | null {
    const row = this.db.prepare("SELECT value FROM migration WHERE name = 'complete'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as { namespaceId: string; count: number } : null;
  }

  async get(key: string, type: 'text' | 'json' | { type?: 'text' | 'json' } = 'text'): Promise<unknown> {
    this.purge();
    const row = this.db.prepare('SELECT value, expiration FROM kv WHERE key = ?').get(key) as ValueRow | undefined;
    if (!row) return null;
    const mode = typeof type === 'string' ? type : type.type ?? 'text';
    return mode === 'json' ? JSON.parse(row.value) as unknown : row.value;
  }

  async put(key: string, value: string, options: { expiration?: number; expirationTtl?: number; metadata?: unknown } = {}): Promise<void> {
    if (options.expiration !== undefined && options.expirationTtl !== undefined) throw new Error('Use one expiration option');
    const expiration = options.expirationTtl !== undefined
      ? Math.floor(Date.now() / 1000) + Math.floor(options.expirationTtl)
      : options.expiration === undefined ? null : Math.floor(options.expiration);
    if (expiration !== null && (!Number.isSafeInteger(expiration) || expiration <= 0)) throw new Error('Invalid expiration');
    this.transaction(() => {
      this.db.prepare(`INSERT INTO kv(key,value,expiration,metadata) VALUES(?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, expiration=excluded.expiration, metadata=excluded.metadata`)
        .run(key, value, expiration, options.metadata === undefined ? null : JSON.stringify(options.metadata));
    });
  }

  async delete(key: string): Promise<void> {
    this.transaction(() => { this.db.prepare('DELETE FROM kv WHERE key = ?').run(key); });
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    this.purge();
    const prefix = options.prefix ?? '';
    const limit = options.limit ?? 1000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid list limit');
    let after = '';
    if (options.cursor) {
      const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as { prefix: string; after: string };
      if (decoded.prefix !== prefix || typeof decoded.after !== 'string') throw new Error('Invalid list cursor');
      after = decoded.after;
    }
    const rows = this.db.prepare(`SELECT key, expiration, metadata FROM kv
      WHERE key > ? AND substr(key,1,length(?)) = ?
      ORDER BY key COLLATE BINARY LIMIT ?`).all(after, prefix, prefix, limit + 1) as unknown as KeyRow[];
    const page = rows.slice(0, limit);
    const keys = page.map(row => ({
      name: row.key,
      ...(row.expiration === null ? {} : { expiration: row.expiration }),
      ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as unknown })
    }));
    const list_complete = rows.length <= limit;
    const last = page.at(-1);
    return { keys, list_complete, ...(!list_complete && last ? { cursor: Buffer.from(JSON.stringify({ prefix, after: last.key })).toString('base64url') } : {}) };
  }

  importSnapshot(snapshot: KvSnapshot): number {
    if (!snapshot.complete || !snapshot.namespaceId || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
      throw new Error('A complete, nonempty KV snapshot is required');
    }
    if (this.migration()) throw new Error('KV migration has already completed');
    const existing = this.db.prepare('SELECT COUNT(*) AS count FROM kv').get() as { count: number };
    if (existing.count !== 0) throw new Error('Refusing to import into a nonempty database');
    return this.transaction(() => {
      const insert = this.db.prepare('INSERT INTO kv(key,value,expiration,metadata) VALUES(?,?,?,?)');
      let count = 0;
      const now = Math.floor(Date.now() / 1000);
      for (const entry of snapshot.entries) {
        if (typeof entry.key !== 'string' || !entry.key || typeof entry.value !== 'string') throw new Error('Invalid KV entry');
        const expiration = entry.expiration === undefined ? null : Math.floor(entry.expiration);
        if (expiration !== null && (!Number.isSafeInteger(expiration) || expiration <= 0)) throw new Error('Invalid KV expiration');
        if (expiration !== null && expiration <= now) continue;
        insert.run(entry.key, entry.value, expiration, entry.metadata === undefined ? null : JSON.stringify(entry.metadata));
        count++;
      }
      if (count === 0) throw new Error('Snapshot contains no live keys');
      this.db.prepare("INSERT INTO migration(name,value) VALUES('complete',?)")
        .run(JSON.stringify({ namespaceId: snapshot.namespaceId, count }));
      return count;
    });
  }
}
