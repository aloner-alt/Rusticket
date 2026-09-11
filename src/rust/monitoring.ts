import type { DiscordEmbed, RustServerConfig } from "../types";

interface ServerPayload { response?: { name: string; status: boolean; numplayers: number; maxplayers: number; bots?: number; map?: string; map_name?: string; map_seed?: number; map_size?: number; fps?: number; fps_avg?: number; entities_count?: number; wipe?: number; last_update?: number; version?: string } }
interface PlayersPayload { response?: { items?: Array<{ name: string }> } }

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.gamemonitoring.net${path}`, { headers: { "User-Agent": "Rusticket/1.0" } });
  if (!response.ok) throw new Error(`GAMEMONITORING HTTP ${response.status}`);
  return response.json<T>();
}

export async function fetchServer(config: RustServerConfig) {
  const result = await api<ServerPayload>(`/servers/${encodeURIComponent(config.monitoringId)}`);
  if (!result.response) throw new Error("Server not found");
  return result.response;
}

export async function fetchPlayers(config: RustServerConfig) {
  const result = await api<PlayersPayload>(`/servers/${encodeURIComponent(config.monitoringId)}/players`);
  return result.response?.items ?? [];
}

export function serverEmbed(config: RustServerConfig, server: Awaited<ReturnType<typeof fetchServer>>, players: Array<{ name: string }> = []): DiscordEmbed {
  const stamp = (value?: number) => value ? `<t:${value}:F> (<t:${value}:R>)` : "Нет данных";
  return { title: `🎮 ${config.label}`, description: server.status ? "🟢 **Сервер онлайн**" : "🔴 **Сервер недоступен**", color: server.status ? 0x2ecc71 : 0xe74c3c,
    fields: [
      { name: "Онлайн", value: `**${server.numplayers}/${server.maxplayers}**${server.bots ? ` (ботов: ${server.bots})` : ""}`, inline: true },
      { name: "Карта", value: server.map_name || server.map || "Неизвестно", inline: true },
      { name: "FPS сервера", value: `${server.fps ?? "—"} (средний: ${server.fps_avg ?? "—"})`, inline: true },
      { name: "Размер / Seed", value: `${server.map_size ?? "—"} / ${server.map_seed ?? "—"}`, inline: true },
      { name: "Сущности", value: (server.entities_count ?? 0).toLocaleString("ru-RU"), inline: true },
      { name: "Версия", value: server.version || "—", inline: true },
      { name: "Последний вайп", value: stamp(server.wipe) }, { name: "Подключение", value: `\`connect ${config.connect}\`` },
      { name: "Игроки на сервере", value: players.length ? players.slice(0, 25).map((player) => player.name).join(", ").slice(0, 1000) : "Список скрыт или пуст" }
    ], footer: { text: "Источник: GAMEMONITORING • обновление каждые 10 минут" },
    timestamp: new Date((server.last_update ?? Math.floor(Date.now() / 1000)) * 1000).toISOString() };
}
