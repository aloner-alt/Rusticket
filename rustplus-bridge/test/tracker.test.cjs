const test = require("node:test");
const assert = require("node:assert/strict");
const { updateState, toSnapshot } = require("../src/tracker.cjs");

const options = { pollMs: 60_000, timeZone: "Europe/Moscow", wipeStartedAt: 1_700_000_000_000 };

test("counts online time between consecutive polls", () => {
  const first = updateState({ version: 1, players: {} }, [{ steamId64: "76561198000000001", name: "Player", isOnline: true }], 1_700_000_000_000, options);
  const second = updateState(first, [{ steamId64: "76561198000000001", name: "Player", isOnline: true }], 1_700_000_060_000, options);
  assert.equal(second.players["76561198000000001"].todayMs, 60_000);
  assert.equal(toSnapshot(second, "main-server", "Server", true).players[0].wipeMs, 60_000);
});

test("does not count an offline player", () => {
  const first = updateState({ version: 1, players: {} }, [{ steamId64: "76561198000000001", name: "Player", isOnline: true }], 1_700_000_000_000, options);
  const second = updateState(first, [{ steamId64: "76561198000000001", name: "Player", isOnline: false }], 1_700_000_060_000, options);
  assert.equal(second.players["76561198000000001"].trackedMs, 0);
  assert.equal(second.players["76561198000000001"].isOnline, false);
});

test("removes players who are no longer in the Rust team", () => {
  const first = updateState({ version: 1, players: {} }, [{ steamId64: "76561198000000001", name: "Player", isOnline: true }], 1_700_000_000_000, options);
  const second = updateState(first, [], 1_700_000_060_000, options);
  assert.deepEqual(second.players, {});
});
