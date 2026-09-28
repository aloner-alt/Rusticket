export class AdminStore {
  constructor(private db: D1Database) {}
  async get<T>(key: string, _type = 'json'): Promise<T | null> {
    const row = await this.db.prepare('SELECT value FROM state WHERE key = ? AND (expires IS NULL OR expires > ?)').bind(key, Date.now()).first<{value:string}>();
    return row ? JSON.parse(row.value) as T : null;
  }
  async put(key: string, value: string, options: {expirationTtl?:number} = {}): Promise<void> {
    await this.db.prepare('INSERT INTO state(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').bind(key,value,options.expirationTtl ? Date.now()+options.expirationTtl*1000 : null).run();
  }
  async delete(key:string): Promise<void> { await this.db.prepare('DELETE FROM state WHERE key=?').bind(key).run(); }
  async list(options:{prefix:string;limit:number}): Promise<{keys:{name:string}[]}> {
    const rows=await this.db.prepare('SELECT key AS name FROM state WHERE key LIKE ? AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?').bind(options.prefix+'%',Date.now(),options.limit).all<{name:string}>();
    return {keys:rows.results};
  }
}
