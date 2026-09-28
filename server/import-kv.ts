import { readFileSync } from 'node:fs';
import { SqliteKV, type KvSnapshot } from './sqlite-kv';

const source = process.argv[2];
if (!source) throw new Error('Usage: tsx server/import-kv.ts /path/to/complete-kv-export.json');
const snapshot = JSON.parse(readFileSync(source, 'utf8')) as KvSnapshot;
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const namespaceId = /^id\s*=\s*"([a-f0-9]+)"/m.exec(wrangler)?.[1];
if (!namespaceId || snapshot.namespaceId !== namespaceId) throw new Error('KV namespace ID does not match wrangler.toml');
const store = new SqliteKV(process.env.SQLITE_PATH ?? '/data/rusticket.sqlite');
try {
  const count = store.importSnapshot(snapshot);
  console.log(`KV import complete: ${count} live keys`);
} finally {
  store.close();
}
