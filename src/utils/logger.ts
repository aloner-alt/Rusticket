import { sendChannelMessage } from "../discord/rest";
import type { DiscordEmbedField, Env } from "../types";

export async function logEvent(env: Env, title: string, fields: DiscordEmbedField[], color = 0x5865f2, components?: unknown[]): Promise<void> {
  try {
    await sendChannelMessage(env, env.LOG_CHANNEL_ID, {
      embeds: [{ title, color, fields, timestamp: new Date().toISOString() }],
      ...(components ? { components } : {}),
      allowed_mentions: { parse: [] }
    });
  } catch (error) {
    console.error("Failed to write Discord audit log", error instanceof Error ? error.message : "unknown error");
  }
}
