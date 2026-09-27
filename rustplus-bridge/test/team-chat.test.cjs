const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, gameClock, answer, createTeamChatHandler } = require('../src/team-chat.cjs');
const { DayNightClock } = require('../src/day-night.cjs');

const packet = (steamId, message, time = 1) => ({
  broadcast: { teamMessage: { message: { steamId, message, time } } }
});
const clanPacket = (steamId, message, time = 1) => ({
  broadcast: { clanMessage: { message: { steamId, message, time } } }
});

test('recognizes only supported dash commands in Rust team chat', () => {
  assert.equal(parseCommand(' -time '), 'time');
  assert.equal(parseCommand('-ВЕРТ'), 'heli');
  assert.equal(parseCommand('-карго'), 'cargo');
  assert.equal(parseCommand('-unknown'), null);
  assert.equal(parseCommand('hello -time'), null);
  assert.equal(parseCommand('[.int] -time'), null);
});

test('formats live time and map marker commands', async () => {
  const request = async method => {
    if (method === 'getTime') return { time: 21.5, sunrise: 6, sunset: 19 };
    if (method === 'getMapMarkers') return { markers: [{ type: 8 }, { type: 5 }, { type: 6 }] };
  };
  assert.equal(gameClock(21.5), '21:30');
  assert.equal(await answer('time', request, 'Europe/Moscow'), 'Игровое время 21:30 (ночь); рассвет/закат не передан Rust+.');
  assert.equal(await answer('heli', request, 'Europe/Moscow'), 'Патрульный вертолёт на карте Rust+: 1.');
  assert.equal(await answer('events', request, 'Europe/Moscow'), 'Маркеры Rust+: верт 1, карго 1, CH47 0, закрытые ящики 1.');
  assert.equal(await answer('events', async () => ({ markers: [{ type: 1 }] }), 'Europe/Moscow'),
    'Rust+ сейчас передаёт только маркеры игроков; карго, верт и ящики через него не видны.');
});

test('replies once to a teammate and limits repeat commands', async () => {
  let time = 100_000;
  const replies = [];
  const handler = createTeamChatHandler({
    request: async () => ({ time: 12, sunrise: 6, sunset: 19 }),
    send: async (_channel, text) => replies.push(text), now: () => time
  });
  const ownSteamId = '76561198000000000';
  await handler(packet(ownSteamId, '-time'));
  await handler(packet(ownSteamId, '-time'));
  await handler(packet(ownSteamId, '-верт', 2));
  assert.deepEqual(replies, ['[.int] Игровое время 12:00 (день); рассвет/закат не передан Rust+.']);
  time += 8_000;
  await handler(packet(ownSteamId, '-help', 3));
  assert.equal(replies.length, 3);
  await handler(packet(ownSteamId, replies[1], 4));
  assert.equal(replies.length, 3);
});

test('does not answer malformed or non-team broadcasts', async () => {
  const replies = [];
  const handler = createTeamChatHandler({ request: async () => ({}), send: async (_channel, value) => replies.push(value) });
  await handler({ broadcast: { entityChanged: { message: '-time' } } });
  await handler(packet('not-a-steam-id', '-time'));
  assert.deepEqual(replies, []);
});

test('routes a clan command reply to clan chat and reports calibrated countdown', async () => {
  let current = 1_000_000;
  const samples = [
    { time: 18, sunrise: 6, sunset: 19 },
    { time: 18.2, sunrise: 6, sunset: 19 }
  ];
  const replies = [];
  const handler = createTeamChatHandler({
    request: async () => samples.shift(),
    send: async (channel, text) => replies.push({ channel, text }),
    clock: new DayNightClock(), now: () => current,
    wait: async () => { current += 60_000; }
  });
  await handler(clanPacket('76561198000000000', '-time'));
  assert.deepEqual(replies, [{ channel: 'clan', text: '[.int] Игровое время 18:12 (день); до ночи примерно 4 мин.' }]);
});
