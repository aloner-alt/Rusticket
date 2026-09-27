const { formatRemaining } = require("./day-night.cjs");

const aliases = new Map([
  ["help", "help"], ["помощь", "help"], ["команды", "help"],
  ["time", "time"], ["время", "time"],
  ["heli", "heli"], ["patrol", "heli"], ["верт", "heli"], ["вертолёт", "heli"], ["вертолет", "heli"],
  ["cargo", "cargo"], ["карго", "cargo"],
  ["ch47", "ch47"], ["chinook", "ch47"], ["чинук", "ch47"],
  ["crate", "crate"], ["ящик", "crate"], ["ящики", "crate"],
  ["events", "events"], ["ивенты", "events"], ["события", "events"],
  ["online", "online"], ["team", "online"], ["команда", "online"],
  ["pop", "pop"], ["онлайн", "pop"],
  ["wipe", "wipe"], ["вайп", "wipe"]
]);

function parseCommand(message) {
  if (typeof message !== "string") return null;
  const match = /^\s*-([\p{L}\d]+)\s*$/u.exec(message);
  return match ? aliases.get(match[1].toLocaleLowerCase("ru-RU")) || null : null;
}

function count(markers, type) {
  return (markers?.markers || []).filter(marker => Number(marker.type) === type).length;
}

function gameClock(value) {
  const time = Number(value);
  if (!Number.isFinite(time)) return "неизвестно";
  const normalized = ((time % 24) + 24) % 24;
  return `${String(Math.floor(normalized)).padStart(2, "0")}:${String(Math.floor((normalized % 1) * 60)).padStart(2, "0")}`;
}

function eventSummary(markers) {
  const all = markers?.markers || [];
  if (all.length && all.every(marker => Number(marker.type) === 1)) {
    return "Rust+ сейчас передаёт только маркеры игроков; карго, верт и ящики через него не видны.";
  }
  return `Маркеры Rust+: верт ${count(markers, 8)}, карго ${count(markers, 5)}, CH47 ${count(markers, 4)}, закрытые ящики ${count(markers, 6)}.`;
}

async function answer(command, request, timeZone, options = {}) {
  switch (command) {
    case "help": return [
      "-time время; -верт патрульный; -карго корабль; -чинук транспортный вертолёт; -ящики закрытые ящики.",
      "-события все маркеры; -команда состав; -онлайн сервер; -вайп дата. Если маркера нет, Rust+ мог его не передать."
    ];
    case "time": {
      let time = await request("getTime", "time");
      let forecast = options.clock?.observe(time, options.now?.() ?? Date.now());
      if (forecast && forecast.remainingMinutes === null && options.wait) {
        try {
          await options.wait(3000);
          time = await request("getTime", "time");
          forecast = options.clock.observe(time, options.now?.() ?? Date.now());
        } catch { /* Keep the first valid time if a second sample fails. */ }
      }
      const hour = Number(time.time);
      const sunrise = Number(time.sunrise);
      const sunset = Number(time.sunset);
      const period = Number.isFinite(hour) && Number.isFinite(sunrise) && Number.isFinite(sunset)
        ? (hour < sunrise || hour >= sunset ? "ночь" : "день") : "цикл неизвестен";
      if (!forecast) return `Игровое время ${gameClock(hour)} (${period}); рассвет/закат не передан Rust+.`;
      const next = forecast.kind === "night" ? "ночи" : "утра";
      return `Игровое время ${gameClock(hour)} (${period}); до ${next} ${formatRemaining(forecast.remainingMinutes)}.`;
    }
    case "heli": {
      const markers = await request("getMapMarkers", "mapMarkers");
      const amount = count(markers, 8);
      return amount ? `Патрульный вертолёт на карте Rust+: ${amount}.` : "Rust+ сейчас не передал маркер патрульного вертолёта.";
    }
    case "cargo": {
      const markers = await request("getMapMarkers", "mapMarkers");
      const amount = count(markers, 5);
      return amount ? `Карго (корабль) на карте Rust+: ${amount}.` : "Rust+ сейчас не передал маркер карго. Это не доказывает, что корабля нет в игре.";
    }
    case "ch47": {
      const markers = await request("getMapMarkers", "mapMarkers");
      const amount = count(markers, 4);
      return amount ? `CH47 (транспортный вертолёт) на карте Rust+: ${amount}.` : "Rust+ сейчас не передал маркер CH47 (транспортного вертолёта).";
    }
    case "crate": {
      const markers = await request("getMapMarkers", "mapMarkers");
      const amount = count(markers, 6);
      return amount ? `Закрытых ящиков (хак-крейтов) на карте Rust+: ${amount}.` : "Rust+ сейчас не передал маркеры закрытых ящиков.";
    }
    case "events": return eventSummary(await request("getMapMarkers", "mapMarkers"));
    case "online": {
      const team = await request("getTeamInfo", "teamInfo");
      const members = team.members || [];
      const names = members.filter(member => member.isOnline).map(member => String(member.name || "Игрок"));
      const prefix = `Команда онлайн ${names.length}/${members.length}`;
      const listed = names.join(", ");
      return listed && `${prefix}: ${listed}`.length <= 120 ? `${prefix}: ${listed}` : `${prefix}.`;
    }
    case "pop": {
      const info = await request("getInfo", "info");
      return `Сервер: ${Number(info.players) || 0}/${Number(info.maxPlayers) || 0}, очередь ${Number(info.queuedPlayers) || 0}.`;
    }
    case "wipe": {
      const info = await request("getInfo", "info");
      const wipeTime = Number(info.wipeTime);
      if (!wipeTime) return "Сервер не передал дату последнего вайпа.";
      const date = new Intl.DateTimeFormat("ru-RU", {
        timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
      }).format(new Date(wipeTime * 1000));
      return `Последний вайп: ${date} (${timeZone}).`;
    }
    default: return null;
  }
}

function createTeamChatHandler({ request, send, clock, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeZone = "Europe/Moscow", now = Date.now, onError = console.error }) {
  const recent = new Map();
  let lastGlobalAt = -Infinity;
  let busy = false;
  return async function handleRustPlusMessage(packet) {
    const team = packet?.broadcast?.teamMessage?.message;
    const clan = packet?.broadcast?.clanMessage?.message;
    const channel = team ? "team" : clan ? "clan" : null;
    const chat = team || clan;
    const command = parseCommand(chat?.message);
    if (!command) return false;
    const sender = chat.steamId?.toString?.();
    if (!sender || !/^\d{17,20}$/.test(sender)) return false;
    const current = now();
    for (const [key, stamp] of recent) if (current - stamp >= 10_000) recent.delete(key);
    const key = `${channel}:${sender}:${chat.time ?? ""}:${chat.message}`;
    if (recent.has(key) || current - lastGlobalAt < 2_000 || current - (recent.get(sender) ?? -Infinity) < 8_000 || busy) return true;
    recent.set(key, current);
    recent.set(sender, current);
    lastGlobalAt = current;
    busy = true;
    try {
      const result = await answer(command, request, timeZone, { clock, wait, now });
      if (result) for (const line of Array.isArray(result) ? result : [result]) await send(channel, `[.int] ${line}`);
    } catch (error) {
      onError(`Rust+ chat command ${command} failed: ${error.message}`);
      try { await send(channel, "[.int] Данные временно недоступны. Попробуйте позже."); }
      catch (sendError) { onError(`Rust+ chat reply failed: ${sendError.message}`); }
    } finally { busy = false; }
    return true;
  };
}

module.exports = { parseCommand, gameClock, eventSummary, answer, createTeamChatHandler };
