import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { SqliteKV } from '../server/sqlite-kv';

const dirs: string[] = [];
function store(): SqliteKV {
  const dir = mkdtempSync(join(tmpdir(), 'rusticket-kv-'));
  dirs.push(dir);
  return new SqliteKV(join(dir, 'test.sqlite'));
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('imports a complete snapshot atomically and preserves values, expiry and metadata', async () => {
  const kv = store();
  const expiry = Math.floor(Date.now() / 1000) + 120;
  expect(kv.importSnapshot({ complete: true, namespaceId: 'namespace', entries: [
    { key: 'a', value: '{"ok":true}', metadata: { source: 'cloudflare' }, expiration: expiry },
    { key: 'b', value: 'plain' }
  ] })).toBe(2);
  expect(kv.migration()).toEqual({ namespaceId: 'namespace', count: 2 });
  expect(await kv.get('a', 'json')).toEqual({ ok: true });
  expect((await kv.list()).keys).toEqual([
    { name: 'a', expiration: expiry, metadata: { source: 'cloudflare' } },
    { name: 'b' }
  ]);
  kv.close();
});

test('supports pagination, prefixes, updates, deletion and expiry', async () => {
  const kv = store();
  await kv.put('p:1', 'one');
  await kv.put('p:2', 'two');
  await kv.put('other', 'three');
  const first = await kv.list({ prefix: 'p:', limit: 1 });
  expect(first.list_complete).toBe(false);
  expect(first.keys).toEqual([{ name: 'p:1' }]);
  if (!first.cursor) throw new Error('Expected cursor');
  const second = await kv.list({ prefix: 'p:', limit: 1, cursor: first.cursor });
  expect(second.keys).toEqual([{ name: 'p:2' }]);
  expect(second.list_complete).toBe(true);
  await kv.put('p:1', 'updated', { expiration: Math.floor(Date.now() / 1000) - 1 });
  expect(await kv.get('p:1')).toBeNull();
  await kv.delete('p:2');
  expect((await kv.list({ prefix: 'p:' })).keys).toEqual([]);
  kv.close();
});

test('rejects incomplete snapshots without partial writes', async () => {
  const kv = store();
  expect(() => kv.importSnapshot({ complete: true, namespaceId: 'namespace', entries: [
    { key: 'valid', value: 'one' },
    { key: '', value: 'invalid' }
  ] })).toThrow();
  expect((await kv.list()).keys).toEqual([]);
  expect(kv.migration()).toBeNull();
  kv.close();
});
