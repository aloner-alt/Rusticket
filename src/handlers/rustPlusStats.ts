import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isPrivateModerator } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { getRustPlusMessageId, getRustPlusSnapshot, getRustPlusSnapshots, saveRustPlusMessageId, saveRustPlusSnapshot } from "../storage/rustPlusStats";
import type { DiscordEmbed, DiscordInteraction, Env, RustPlusPlayerStats, RustPlusSnapshot } from "../types";

const MAX_SNAPSHOT_BYTES = 128 * 1024;

function duration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function validPlayer(value: unknown): value is RustPlusPlayerStats {
  if (!value || typeof value !== "object") return false;
  const player = value as Record<string, unknown>;
  return typeof player.steamId64 === "string" && /^\d{17}$/.test(player.steamId64)
    && typeof player.name === "string" && player.name.length > 0 && player.name.length <= 100
    && typeof player.isOnline === "boolean"
    && typeof player.lastSeenAt === "number"
    && typeof player.todayMs === "number" && player.todayMs >= 0
    && typeof player.wipeMs === "number" && player.wipeMs >= 0
    && typeof player.trackedMs === "number" && player.trackedMs >= 0
    && (player.sessionStartedAt === undefined || typeof player.sessionStartedAt === "number");
}

function validSnapshot(value: unknown): value is RustPlusSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  const server = snapshot.server as Record<string, unknown> | undefined;
  const validServer = server === undefined || (
    typeof server.players === "number" && server.players >= 0
    && typeof server.maxPlayers === "number" && server.maxPlayers >= 0
    && typeof server.queuedPlayers === "number" && server.queuedPlayers >= 0
    && typeof server.map === "string" && server.map.length <= 100
    && typeof server.gameTime === "string" && /^\d{2}:\d{2}$/.test(server.gameTime)
    && ["morning", "day", "evening", "night"].includes(String(server.dayPhase))
    && Array.isArray(server.events) && server.events.length <= 20 && server.events.every(event => typeof event === "string" && event.length <= 100)
  );
  return typeof snapshot.serverId === "string" && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(snapshot.serverId)
    && typeof snapshot.serverName === "string" && snapshot.serverName.length > 0 && snapshot.serverName.length <= 100
    && typeof snapshot.connected === "boolean"
    && typeof snapshot.updatedAt === "number"
    && (snapshot.wipeStartedAt === undefined || typeof snapshot.wipeStartedAt === "number")
    && validServer && Array.isArray(snapshot.players) && snapshot.players.length <= 100 && snapshot.players.every(validPlayer);
}

async function authorized(request: Request, secret: string | undefined): Promise<boolean> {
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !supplied) return false;
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied))
  ]);
  const expected = new Uint8Array(expectedHash); const actual = new Uint8Array(suppliedHash);
  return expected.length === actual.length && expected.every((byte, index) => byte === actual[index]);
}

function playerLines(players: RustPlusPlayerStats[], limit = 18): string {
  const ordered = [...players].sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || b.wipeMs - a.wipeMs);
  if (!ordered.length) return "Команда пока не получена от Rust+.";
  const lines = ordered.slice(0, limit).map(player => {
    const status = player.isOnline ? "🟢" : "⚫";
    const session = player.isOnline && player.sessionStartedAt ? ` • сессия ${duration(Date.now() - player.sessionStartedAt)}` : "";
    return `${status} **${player.name}** — сегодня ${duration(player.todayMs)} • вайп ${duration(player.wipeMs)}${session}`;
  });
  if (ordered.length > limit) lines.push(`…и ещё ${ordered.length - limit}`);
  return lines.join("\n").slice(0, 4000);
}

export function rustPlusEmbed(snapshot: RustPlusSnapshot): DiscordEmbed {
  const online = snapshot.players.filter(player => player.isOnline).length;
  const stale = Date.now() - snapshot.updatedAt > 180_000;
  return {
    title: `🎮 Rust+ — ${snapshot.serverName}`,
    description: playerLines(snapshot.players),
    color: !snapshot.connected || stale ? 0xe67e22 : 0x2ecc71,
    fields: [
      { name: "Состояние", value: snapshot.connected && !stale ? "🟢 Подключено" : "🟠 Нет свежих данных", inline: true },
      { name: "Онлайн команды", value: `**${online}/${snapshot.players.length}**`, inline: true },
      { name: "Обновлено", value: `<t:${Math.floor(snapshot.updatedAt / 1000)}:R>`, inline: true },
      ...(snapshot.server ? [
        { name: "Сервер", value: `${snapshot.server.players}/${snapshot.server.maxPlayers}${snapshot.server.queuedPlayers ? ` • очередь ${snapshot.server.queuedPlayers}` : ""}`, inline: true },
        { name: "Игровое время", value: `${snapshot.server.gameTime} • ${{ morning: "🌅 утро", day: "☀️ день", evening: "🌇 вечер", night: "🌙 ночь" }[snapshot.server.dayPhase]}`, inline: true },
        { name: "Карта", value: snapshot.server.map || "Неизвестна", inline: true },
        { name: "События", value: snapshot.server.events.length ? snapshot.server.events.join("\n") : "Сейчас важных событий нет" }
      ] : [])
    ],
    footer: { text: "Время считается только пока Rust+ bridge работает" },
    timestamp: new Date(snapshot.updatedAt).toISOString()
  };
}

async function publishSnapshot(env: Env, snapshot: RustPlusSnapshot): Promise<void> {
  const body = { embeds: [rustPlusEmbed(snapshot)], allowed_mentions: { parse: [] } };
  const currentMessageId = await getRustPlusMessageId(env, snapshot.serverId);
  if (currentMessageId) {
    try {
      await discordRest(env, `/channels/${env.RUST_STATS_CHANNEL_ID}/messages/${currentMessageId}`, { method: "PATCH", body: JSON.stringify(body) });
      return;
    } catch (error) {
      console.error("Rust+ statistics message update failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  const message = await sendChannelMessage(env, env.RUST_STATS_CHANNEL_ID, body);
  await saveRustPlusMessageId(env, snapshot.serverId, message.id);
}

async function notifyChanges(env: Env, previous: RustPlusSnapshot | null, current: RustPlusSnapshot): Promise<void> {
  if (!previous?.server || !current.connected || !current.server) return;
  const notices: string[] = [];
  if (previous.server.dayPhase !== current.server.dayPhase) {
    const label = { morning: "🌅 Наступило утро", day: "☀️ Наступил день", evening: "🌇 Наступил вечер", night: "🌙 Наступила ночь" }[current.server.dayPhase];
    notices.push(`${label} — игровое время **${current.server.gameTime}**.`);
  }
  const previousEvents = new Set(previous.server.events);
  notices.push(...current.server.events.filter(event => !previousEvents.has(event)).map(event => `Новое событие: **${event}**`));
  if (notices.length) await sendChannelMessage(env, env.RUST_STATS_CHANNEL_ID, {
    content: `🎮 **${current.serverName}**\n${notices.join("\n")}`,
    allowed_mentions: { parse: [] }
  });
}

export async function receiveRustPlusSnapshot(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env.RUSTPLUS_BRIDGE_TOKEN))) return new Response("Unauthorized", { status: 401 });
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_SNAPSHOT_BYTES) return new Response("Payload too large", { status: 413 });
  let value: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) return new Response("Payload too large", { status: 413 });
    value = JSON.parse(raw) as unknown;
  } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!validSnapshot(value)) return new Response("Invalid snapshot", { status: 400 });
  if (Math.abs(Date.now() - value.updatedAt) > 600_000) return new Response("Stale snapshot", { status: 400 });
  const previous = await getRustPlusSnapshot(env, value.serverId);
  await saveRustPlusSnapshot(env, value);
  await publishSnapshot(env, value);
  await notifyChanges(env, previous, value);
  return Response.json({ ok: true });
}

export async function showRustPlusStats(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const snapshots = await getRustPlusSnapshots(env);
  if (!snapshots.length) return ephemeral("⚠️ Rust+ ещё не подключён. После запуска bridge статистика появится автоматически.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: { embeds: snapshots.slice(0, 10).map(rustPlusEmbed), flags: 64 } });
}
