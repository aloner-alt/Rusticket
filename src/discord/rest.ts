import type { DiscordEmbed, Env } from "../types";

const API_BASE = "https://discord.com/api/v10";

export class DiscordRestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DiscordRestError";
  }
}

export async function discordRest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${env.DISCORD_BOT_TOKEN}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const requestId = response.headers.get("x-ratelimit-bucket") ?? "unknown";
    throw new DiscordRestError(response.status, `Discord REST ${response.status}; bucket=${requestId}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json<T>();
}

export async function editOriginalResponse(env: Env, token: string, body: unknown): Promise<void> {
  await discordRest(env, `/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export async function sendChannelMessage(env: Env, channelId: string, body: {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: unknown[];
  allowed_mentions?: unknown;
}): Promise<{ id: string }> {
  return discordRest(env, `/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(body) });
}
