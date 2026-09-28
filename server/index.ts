import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import worker from '../src/index';
import type { Env } from '../src/types';
import { SqliteKV } from './sqlite-kv';
import { DiscordGateway, deliverInteraction } from './gateway';
import { processRustPlusSnapshot } from '../src/handlers/rustPlusStats';

const gatewaySetting = process.env.DISCORD_GATEWAY_ENABLED ?? 'false';
if (gatewaySetting !== 'true' && gatewaySetting !== 'false') throw new Error('DISCORD_GATEWAY_ENABLED must be true or false');
const gatewayEnabled = gatewaySetting === 'true' && !process.argv.includes('--offline-smoke');
const databasePath = process.env.SQLITE_PATH ?? '/data/rusticket.sqlite';
if (!existsSync(databasePath)) throw new Error('KV database missing; import the complete Cloudflare KV export first');
const kv = new SqliteKV(databasePath);
const migration = kv.migration();
if (!migration || migration.count < 1) throw new Error('KV migration is incomplete; refusing to start');
const importedKeys = migration.count;
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const varsSection = wrangler.split('[vars]')[1]?.split('\n[')[0] ?? '';
const configuredKeys = [...varsSection.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)].flatMap(match => match[1] ? [match[1]] : []);
const required = new Set([...configuredKeys, 'DISCORD_BOT_TOKEN', 'STEAM_API_KEY', 'PRIVATE_INVITE_URL']);
const missing = [...required].filter(key => !process.env[key]?.trim());
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
const env = { ...process.env, APPLICATIONS: kv as unknown as KVNamespace } as unknown as Env;
const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

const pending = new Set<Promise<unknown>>();
function context(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>): void {
      const tracked = Promise.resolve(promise)
        .catch((error: unknown) => { console.error('Background task failed:', error instanceof Error ? error.name : 'unknown'); })
        .finally(() => { pending.delete(tracked); });
      pending.add(tracked);
    },
    passThroughOnException(): void { /* no upstream */ }
  } as ExecutionContext;
}

function scheduled(): void {
  try {
    worker.scheduled({ scheduledTime: Date.now(), cron: '*/10 * * * *', noRetry() {} }, env, context());
    console.log('Scheduled tasks dispatched');
  } catch (error) {
    console.error('Scheduled dispatch failed:', error instanceof Error ? error.name : 'unknown');
  }
}

let gateway: DiscordGateway | undefined;
const snapshotFile = process.env.RUSTPLUS_SNAPSHOT_FILE;
let lastSnapshotMtime = 0;
let snapshotInFlight = false;
async function ingestRustPlusSnapshot(): Promise<void> {
  if (!gatewayEnabled || !snapshotFile || snapshotInFlight) return;
  snapshotInFlight = true;
  try {
    const info = await stat(snapshotFile);
    if (info.mtimeMs <= lastSnapshotMtime) return;
    if (info.size > 128 * 1024) {
      lastSnapshotMtime = info.mtimeMs;
      console.error('Rust+ snapshot exceeds size limit');
      return;
    }
    const raw = await readFile(snapshotFile, 'utf8');
    const result = await processRustPlusSnapshot(JSON.parse(raw) as unknown, env);
    if (!result.ok) console.error(`Rust+ snapshot rejected: HTTP ${result.status}`);
    lastSnapshotMtime = info.mtimeMs;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    console.error('Rust+ snapshot ingestion failed:', error instanceof Error ? error.name : 'unknown');
  } finally {
    snapshotInFlight = false;
  }
}
const snapshotInterval = gatewayEnabled ? setInterval(() => { void ingestRustPlusSnapshot(); }, 15_000) : undefined;
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    const healthy = !gatewayEnabled || gateway?.isReady() === true;
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: healthy ? 'ok' : 'starting', sqlite: 'ready', gateway: gatewayEnabled ? gateway?.isReady() ? 'enabled' : 'connecting' : 'disabled', scheduled: gatewayEnabled ? 'enabled' : 'disabled', importedKeys }));
    return;
  }
  response.writeHead(404);
  response.end();
});
const interval = gatewayEnabled ? setInterval(scheduled, 600_000) : undefined;
server.listen(port, '0.0.0.0', () => {
  console.log('Rusticket health server listening');
  if (gatewayEnabled) {
    scheduled();
    void ingestRustPlusSnapshot();
    gateway = new DiscordGateway(env.DISCORD_BOT_TOKEN, interaction => deliverInteraction(interaction, env, context()));
    void gateway.start().catch((error: unknown) => {
      console.error('Gateway startup failed:', error instanceof Error ? error.message : 'unknown');
      process.exitCode = 1;
      void shutdown();
    });
  } else {
    console.log('Discord Gateway and scheduled tasks disabled');
  }
});

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (interval) clearInterval(interval);
  if (snapshotInterval) clearInterval(snapshotInterval);
  gateway?.stop();
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 20_000);
  await new Promise<void>(resolve => server.close(() => { resolve(); }));
  await Promise.allSettled([...pending]);
  clearTimeout(deadline);
  kv.close();
  process.exit(process.exitCode ?? 0);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
