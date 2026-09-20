import { estimateRustInventory, type InventoryEstimate } from "./inventory";
import { parseSteamProfileUrl } from "./steamUrl";
import type { Env } from "../types";

interface Summary { steamid: string; personaname: string; profileurl: string; avatarfull?: string; communityvisibilitystate?: number; timecreated?: number; lastlogoff?: number }
interface BanInfo { SteamId: string; CommunityBanned: boolean; VACBanned: boolean; NumberOfVACBans: number; DaysSinceLastBan: number; NumberOfGameBans: number; EconomyBan: string }
interface Game { appid: number; playtime_forever: number; playtime_2weeks?: number }
interface Stat { name: string; value: number }

async function json<T>(url: URL): Promise<T | null> {
  const response = await fetch(url, { headers: { "User-Agent": "Rusticket/1.0" } });
  return response.ok ? response.json<T>() : null;
}

async function resolveSteamId(input: string, key: string): Promise<string | null> {
  if (/^7656119\d{10}$/.test(input.trim())) return input.trim();
  const parsed = parseSteamProfileUrl(input.trim()); if (!parsed) return null;
  if (parsed.type === "steamid") return parsed.value;
  const url = new URL("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/"); url.searchParams.set("key", key); url.searchParams.set("vanityurl", parsed.value);
  const result = await json<{ response?: { success?: number; steamid?: string } }>(url);
  return result?.response?.success === 1 ? result.response.steamid ?? null : null;
}

export interface PlayerInspection { steamId64: string; summary: Summary; bans?: BanInfo; rustHours?: number; rustRecentHours?: number; stats?: Stat[]; inventory: InventoryEstimate }

export async function inspectPlayer(env: Env, input: string): Promise<PlayerInspection | null> {
  const steamId64 = await resolveSteamId(input, env.STEAM_API_KEY); if (!steamId64) return null;
  const cacheKey = `player-inspection:${steamId64}`;
  const cached = await env.APPLICATIONS.get<PlayerInspection>(cacheKey, "json");
  if (cached) return cached;
  const summaryUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"); summaryUrl.searchParams.set("key", env.STEAM_API_KEY); summaryUrl.searchParams.set("steamids", steamId64);
  const bansUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/"); bansUrl.searchParams.set("key", env.STEAM_API_KEY); bansUrl.searchParams.set("steamids", steamId64);
  const gamesUrl = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"); gamesUrl.searchParams.set("key", env.STEAM_API_KEY); gamesUrl.searchParams.set("steamid", steamId64); gamesUrl.searchParams.set("include_played_free_games", "true"); gamesUrl.searchParams.set("appids_filter[0]", "252490");
  const statsUrl = new URL("https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/"); statsUrl.searchParams.set("key", env.STEAM_API_KEY); statsUrl.searchParams.set("steamid", steamId64); statsUrl.searchParams.set("appid", "252490");
  const [summaries, bans, games, stats, inventory] = await Promise.all([
    json<{ response?: { players?: Summary[] } }>(summaryUrl), json<{ players?: BanInfo[] }>(bansUrl),
    json<{ response?: { games?: Game[] } }>(gamesUrl), json<{ playerstats?: { stats?: Stat[] } }>(statsUrl), estimateRustInventory(env, steamId64)
  ]);
  const summary = summaries?.response?.players?.[0]; if (!summary) return null;
  const rust = games?.response?.games?.find((game) => game.appid === 252490);
  const result: PlayerInspection = { steamId64, summary, inventory, ...(bans?.players?.[0] ? { bans: bans.players[0] } : {}),
    ...(rust ? { rustHours: Math.floor(rust.playtime_forever / 60), rustRecentHours: Math.floor((rust.playtime_2weeks ?? 0) / 60) } : {}),
    ...(stats?.playerstats?.stats ? { stats: stats.playerstats.stats } : {}) };
  await env.APPLICATIONS.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
  return result;
}
