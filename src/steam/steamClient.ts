import { RUST_APP_ID } from "../config/requirements";
import { parseSteamProfileUrl } from "./steamUrl";
import type { SteamGame, SteamVerification } from "./steamTypes";

interface ResolveVanityResponse { response?: { success?: number; steamid?: string } }
interface PlayerSummaryResponse { response?: { players?: Array<{ steamid: string; personaname: string }> } }
interface OwnedGamesResponse { response?: { game_count?: number; games?: SteamGame[] } }

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "Rusticket/1.0" } });
  if (!response.ok) throw new Error(`Steam API returned ${response.status}`);
  return response.json<T>();
}

export async function verifySteamProfile(input: string, apiKey: string): Promise<SteamVerification> {
  const parsed = parseSteamProfileUrl(input);
  if (!parsed) return { ok: false, reason: "INVALID_URL" };

  try {
    let steamId64 = parsed.value;
    if (parsed.type === "vanity") {
      const url = new URL("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("vanityurl", parsed.value);
      const result = await fetchJson<ResolveVanityResponse>(url);
      if (result.response?.success !== 1 || !result.response.steamid) {
        return { ok: false, reason: "ACCOUNT_NOT_FOUND" };
      }
      steamId64 = result.response.steamid;
    }

    const summaryUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    summaryUrl.searchParams.set("key", apiKey);
    summaryUrl.searchParams.set("steamids", steamId64);
    const summary = await fetchJson<PlayerSummaryResponse>(summaryUrl);
    const player = summary.response?.players?.[0];
    if (!player) return { ok: false, reason: "ACCOUNT_NOT_FOUND" };

    const gamesUrl = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
    gamesUrl.searchParams.set("key", apiKey);
    gamesUrl.searchParams.set("steamid", steamId64);
    gamesUrl.searchParams.set("include_played_free_games", "true");
    const owned = await fetchJson<OwnedGamesResponse>(gamesUrl);
    if (owned.response?.game_count === undefined || !owned.response.games) {
      return { ok: false, reason: "PRIVATE_GAMES", steamId64, profileUrl: `https://steamcommunity.com/profiles/${steamId64}`, steamName: player.personaname };
    }

    const rust = owned.response.games.find((game) => game.appid === RUST_APP_ID);
    if (!rust) return { ok: false, reason: "RUST_NOT_FOUND", steamId64 };

    return {
      ok: true,
      steamId64,
      profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
      steamName: player.personaname,
      rustHours: Math.floor(rust.playtime_forever / 60)
    };
  } catch {
    return { ok: false, reason: "API_ERROR" };
  }
}
