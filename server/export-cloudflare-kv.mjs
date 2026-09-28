import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';

const accountId = process.env.CF_ACCOUNT_ID;
const token = process.env.CF_API_TOKEN;
const destination = process.argv[2];
if (!accountId || !token || !destination) throw new Error('Set CF_ACCOUNT_ID and CF_API_TOKEN, then provide an output JSON path');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const namespaceId = /^id\s*=\s*"([a-f0-9]+)"/m.exec(wrangler)?.[1];
if (!namespaceId) throw new Error('Production KV namespace ID is missing');
const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${namespaceId}`;
const headers = { Authorization: `Bearer ${token}` };
const entries = [];
let cursor;
do {
  const url = new URL(`${base}/keys`);
  url.searchParams.set('limit', '1000');
  if (cursor) url.searchParams.set('cursor', cursor);
  const pageResponse = await fetch(url, { headers });
  if (!pageResponse.ok) throw new Error(`KV list failed: HTTP ${pageResponse.status}`);
  const page = await pageResponse.json();
  if (!page.success || !Array.isArray(page.result)) throw new Error('KV list failed');
  for (const item of page.result) {
    if (typeof item.name !== 'string') throw new Error('Invalid KV key name');
    const valueResponse = await fetch(`${base}/values/${encodeURIComponent(item.name)}`, { headers });
    if (!valueResponse.ok) throw new Error(`KV value fetch failed: HTTP ${valueResponse.status}`);
    entries.push({ key: item.name, value: await valueResponse.text(),
      ...(item.expiration === undefined ? {} : { expiration: item.expiration }),
      ...(item.metadata === undefined ? {} : { metadata: item.metadata }) });
  }
  cursor = page.result_info?.cursor || undefined;
} while (cursor);
const fd = openSync(destination, 'wx', 0o600);
try {
  writeFileSync(fd, JSON.stringify({ complete: true, namespaceId, entries }));
  fsyncSync(fd);
} finally { closeSync(fd); }
console.log(`Complete KV export saved: ${entries.length} keys`);
