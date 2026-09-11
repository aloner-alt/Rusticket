export function parseStrictInteger(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d+)\s*\+?$/.exec(trimmed);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function normalizeChannelName(username: string, suffix: string): string {
  const safe = username
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "user";
  return `application-${safe}-${suffix}`.slice(0, 100);
}
