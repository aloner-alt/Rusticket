import type { Env, RustPlusSnapshot } from "../types";

const SNAPSHOT_PREFIX = "rustplus:snapshot:";
const MESSAGE_PREFIX = "rustplus:discord-message:";

export function getRustPlusSnapshot(env: Env, serverId: string): Promise<RustPlusSnapshot | null> {
  return env.APPLICATIONS.get<RustPlusSnapshot>(`${SNAPSHOT_PREFIX}${serverId}`, "json");
}

export function saveRustPlusSnapshot(env: Env, snapshot: RustPlusSnapshot): Promise<void> {
  return env.APPLICATIONS.put(`${SNAPSHOT_PREFIX}${snapshot.serverId}`, JSON.stringify(snapshot), { expirationTtl: 172_800 });
}

export async function getRustPlusSnapshots(env: Env): Promise<RustPlusSnapshot[]> {
  const snapshots: RustPlusSnapshot[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: SNAPSHOT_PREFIX, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const snapshot = await env.APPLICATIONS.get<RustPlusSnapshot>(key.name, "json");
      if (snapshot) snapshots.push(snapshot);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return snapshots.sort((a, b) => a.serverName.localeCompare(b.serverName, "ru"));
}

export function getRustPlusMessageId(env: Env, serverId: string): Promise<string | null> {
  return env.APPLICATIONS.get(`${MESSAGE_PREFIX}${serverId}`);
}

export function saveRustPlusMessageId(env: Env, serverId: string, messageId: string): Promise<void> {
  return env.APPLICATIONS.put(`${MESSAGE_PREFIX}${serverId}`, messageId);
}
