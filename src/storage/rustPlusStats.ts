import type { Env, RustPlusSnapshot } from "../types";

const SNAPSHOT_KEY = "rustplus:snapshot";
const MESSAGE_KEY = "rustplus:discord-message";

export function getRustPlusSnapshot(env: Env): Promise<RustPlusSnapshot | null> {
  return env.APPLICATIONS.get<RustPlusSnapshot>(SNAPSHOT_KEY, "json");
}

export function saveRustPlusSnapshot(env: Env, snapshot: RustPlusSnapshot): Promise<void> {
  return env.APPLICATIONS.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: 172_800 });
}

export function getRustPlusMessageId(env: Env): Promise<string | null> {
  return env.APPLICATIONS.get(MESSAGE_KEY);
}

export function saveRustPlusMessageId(env: Env, messageId: string): Promise<void> {
  return env.APPLICATIONS.put(MESSAGE_KEY, messageId);
}
