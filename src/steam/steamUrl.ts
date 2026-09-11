export type ParsedSteamProfile =
  | { type: "steamid"; value: string; profileUrl: string }
  | { type: "vanity"; value: string; profileUrl: string };

export function parseSteamProfileUrl(input: string): ParsedSteamProfile | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "steamcommunity.com" && hostname !== "www.steamcommunity.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [kind, rawValue] = parts;
  if (!kind || !rawValue) return null;
  const value = decodeURIComponent(rawValue);

  if (kind === "profiles" && /^\d{17}$/.test(value)) {
    return { type: "steamid", value, profileUrl: `https://steamcommunity.com/profiles/${value}` };
  }
  if (kind === "id" && /^[A-Za-z0-9_-]{2,64}$/.test(value)) {
    return { type: "vanity", value, profileUrl: `https://steamcommunity.com/id/${encodeURIComponent(value)}` };
  }
  return null;
}
