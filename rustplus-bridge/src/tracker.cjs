function dateKey(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function emptyPlayer(member, now) {
  return {
    steamId64: String(member.steamId64), name: member.name, isOnline: Boolean(member.isOnline),
    firstSeenAt: now, lastSeenAt: now, sessionStartedAt: member.isOnline ? now : undefined,
    todayMs: 0, wipeMs: 0, trackedMs: 0
  };
}

function updateState(state, members, now, options) {
  const pollMs = options.pollMs;
  const currentDate = dateKey(now, options.timeZone);
  const previousDate = state.dateKey;
  const wipeChanged = options.wipeStartedAt && state.wipeStartedAt !== options.wipeStartedAt;
  const elapsed = Math.max(0, Math.min(now - (state.lastPollAt || now), pollMs * 2));
  const next = {
    version: 1, dateKey: currentDate, lastPollAt: now,
    ...(options.wipeStartedAt ? { wipeStartedAt: options.wipeStartedAt } : {}),
    players: Object.fromEntries(Object.entries(state.players || {}).map(([id, player]) => [id, { ...player }]))
  };

  for (const player of Object.values(next.players)) {
    player.isOnline = false;
    if (previousDate && previousDate !== currentDate) player.todayMs = 0;
    if (wipeChanged) player.wipeMs = 0;
  }

  for (const member of members) {
    const id = String(member.steamId64);
    const wasOnline = Boolean(state.players?.[id]?.isOnline);
    const player = next.players[id] || emptyPlayer(member, now);
    if (member.isOnline && wasOnline) {
      player.todayMs += elapsed;
      player.wipeMs += elapsed;
      player.trackedMs += elapsed;
    }
    if (member.isOnline && !wasOnline) player.sessionStartedAt = now;
    if (!member.isOnline) delete player.sessionStartedAt;
    player.name = member.name;
    player.isOnline = Boolean(member.isOnline);
    if (member.isOnline || !player.lastSeenAt) player.lastSeenAt = now;
    next.players[id] = player;
  }
  const currentTeam = new Set(members.map(member => String(member.steamId64)));
  for (const id of Object.keys(next.players)) if (!currentTeam.has(id)) delete next.players[id];
  return next;
}

function toSnapshot(state, serverName, connected, now = Date.now()) {
  return {
    serverName, connected, updatedAt: now,
    ...(state.wipeStartedAt ? { wipeStartedAt: state.wipeStartedAt } : {}),
    players: Object.values(state.players || {}).map(player => ({
      steamId64: player.steamId64, name: player.name, isOnline: player.isOnline,
      lastSeenAt: player.lastSeenAt, ...(player.sessionStartedAt ? { sessionStartedAt: player.sessionStartedAt } : {}),
      todayMs: player.todayMs, wipeMs: player.wipeMs, trackedMs: player.trackedMs
    }))
  };
}

module.exports = { dateKey, updateState, toSnapshot };
