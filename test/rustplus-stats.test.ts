import { describe, expect, it } from "vitest";
import { rustPlusEmbed } from "../src/handlers/rustPlusStats";

describe("Rust+ statistics", () => {
  it("shows team online and accumulated play time", () => {
    const embed = rustPlusEmbed({
      serverId: "test-server",
      serverName: "Test server",
      connected: true,
      updatedAt: Date.now(),
      server: { players: 120, maxPlayers: 200, queuedPlayers: 15, map: "Procedural Map", gameTime: "19:30", dayPhase: "evening", events: ["🚢 Cargo Ship активен"] },
      players: [
        { steamId64: "76561198000000001", name: "Online", isOnline: true, lastSeenAt: Date.now(), sessionStartedAt: Date.now() - 3_600_000, todayMs: 7_200_000, wipeMs: 36_000_000, trackedMs: 36_000_000 },
        { steamId64: "76561198000000002", name: "Offline", isOnline: false, lastSeenAt: Date.now() - 60_000, todayMs: 0, wipeMs: 3_600_000, trackedMs: 3_600_000 }
      ]
    });
    expect(embed.fields?.find(field => field.name === "Онлайн команды")?.value).toBe("**1/2**");
    expect(embed.description).toContain("Online");
    expect(embed.description).toContain("вайп 10 ч 0 мин");
    expect(embed.fields?.find(field => field.name === "Игровое время")?.value).toContain("вечер");
  });
});
