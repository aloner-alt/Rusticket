export type SteamFailure = "INVALID_URL" | "ACCOUNT_NOT_FOUND" | "PRIVATE_GAMES" | "RUST_NOT_FOUND" | "API_ERROR";

export type SteamVerification =
  | { ok: true; steamId64: string; profileUrl: string; steamName: string; rustHours: number }
  | { ok: false; reason: SteamFailure; steamId64?: string; profileUrl?: string; steamName?: string };

export interface SteamGame {
  appid: number;
  playtime_forever: number;
}
