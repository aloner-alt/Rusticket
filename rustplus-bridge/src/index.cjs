require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const RustPlus = require("@rustwirebot/rustplus.js");
const { updateState, toSnapshot } = require("./tracker.cjs");
const { createTeamChatHandler, gameClock } = require("./team-chat.cjs");
const { DayNightClock, formatRemaining } = require("./day-night.cjs");

const required = ["RUSTPLUS_SERVER_ID", "RUSTPLUS_IP", "RUSTPLUS_PORT", "RUSTPLUS_PLAYER_ID", "RUSTPLUS_PLAYER_TOKEN", ];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
if (!process.env.SNAPSHOT_FILE && (!process.env.WORKER_URL || !process.env.RUSTPLUS_BRIDGE_TOKEN)) {
  throw new Error("Set SNAPSHOT_FILE or both WORKER_URL and RUSTPLUS_BRIDGE_TOKEN");
}
if (process.env.SNAPSHOT_FILE && !path.isAbsolute(process.env.SNAPSHOT_FILE)) {
  throw new Error("SNAPSHOT_FILE must be an absolute path");
}
if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(process.env.RUSTPLUS_SERVER_ID)) throw new Error("RUSTPLUS_SERVER_ID must contain 2-40 lowercase letters, numbers, _ or -");

const pollSeconds = Math.max(30, Number(process.env.POLL_SECONDS || 60));
const pollMs = pollSeconds * 1000;
const timeZone = process.env.TIME_ZONE || "Europe/Moscow";
const configuredWipeStartedAt = process.env.RUSTPLUS_WIPE_STARTED_AT ? Date.parse(process.env.RUSTPLUS_WIPE_STARTED_AT) : undefined;
if (process.env.RUSTPLUS_WIPE_STARTED_AT && !Number.isFinite(configuredWipeStartedAt)) throw new Error("RUSTPLUS_WIPE_STARTED_AT must be an ISO date");
const stateDir = path.join(__dirname, "..", ".data");
const statePath = path.join(stateDir, "player-stats.json");
const reminderPath = path.join(stateDir, "day-night-reminders.json");
let state = { version: 1, players: {} };
let timer;
let reminderTimer;
let reconnectTimer;
let polling = false;
let reminding = false;
let connected = false;
let shuttingDown = false;
let selfOnline = false;
let clanAvailable = false;
let monumentsLoaded = false;
let oilRigMonuments = [];
let mapWipeTime;
let selfWasOffline = false;
let lastMarkerTypes = "";

async function loadState() {
  try { state = JSON.parse(await fs.readFile(statePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function saveState() {
  await fs.mkdir(stateDir, { recursive: true });
  const temporary = `${statePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, statePath);
}

function steamId(value) {
  return typeof value === "string" ? value : value?.toString?.() || String(value);
}

function getTeamInfo(rustplus) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Rust+ team request timed out")), 15_000);
    rustplus.getTeamInfo(message => {
      clearTimeout(timeout);
      const error = message?.response?.error?.error;
      if (error) return reject(new Error(error));
      const members = message?.response?.teamInfo?.members;
      if (!Array.isArray(members)) return reject(new Error("Rust+ returned no team information"));
      resolve(members.map(member => ({ steamId64: steamId(member.steamId), name: member.name || steamId(member.steamId), isOnline: Boolean(member.isOnline) })));
      return true;
    });
  });
}

function request(rustplus, method, responseKey) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Rust+ ${method} request timed out`)), 15_000);
    rustplus[method](message => {
      clearTimeout(timeout);
      const error = message?.response?.error?.error;
      if (error) return reject(new Error(error));
      const value = message?.response?.[responseKey];
      if (!value) return reject(new Error(`Rust+ returned no ${responseKey}`));
      resolve(value);
      return true;
    });
  });
}

function number(value) {
  const result = Number(value?.toString?.() ?? value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function clock(value) {
  const normalized = ((number(value) % 24) + 24) % 24;
  const hours = Math.floor(normalized);
  const minutes = Math.floor((normalized - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function phase(time) {
  const current = number(time.time); const sunrise = number(time.sunrise); const sunset = number(time.sunset);
  if (current < sunrise || current >= sunset) return "night";
  if (current < sunrise + 1.5) return "morning";
  if (current >= sunset - 1.5) return "evening";
  return "day";
}

function eventLines(markers) {
  const allMarkers = markers.markers || [];
  const types = allMarkers.map(marker => number(marker.type));
  const count = type => types.filter(value => value === type).length;
  const crates = allMarkers.filter(marker => number(marker.type) === 6);
  const rigCrates = crates.filter(crate => oilRigMonuments.some(rig => Math.hypot(number(crate.x) - rig.x, number(crate.y) - rig.y) <= 350));
  return [
    count(5) ? "🚢 Cargo Ship активен" : undefined,
    count(8) ? "🚁 Патрульный вертолёт активен" : undefined,
    count(4) ? "🚁 CH47 активен" : undefined,
    rigCrates.length ? `🛢️ Oil Rig: активных закрытых ящиков ${rigCrates.length}` : undefined,
    crates.length - rigCrates.length > 0 ? `🔒 Другие закрытые ящики: ${crates.length - rigCrates.length}` : undefined
  ].filter(Boolean);
}

async function loadMonuments(rustplus) {
  if (monumentsLoaded) return;
  const map = await request(rustplus, "getMap", "map");
  oilRigMonuments = (map.monuments || [])
    .filter(monument => String(monument.token || "").toLowerCase().includes("oilrig"))
    .map(monument => ({ x: number(monument.x), y: number(monument.y) }));
  monumentsLoaded = true;
  console.log(`Loaded ${oilRigMonuments.length} Oil Rig monument(s) from Rust+ map`);
}

async function getServerStatus(rustplus) {
  const [info, time, markers] = await Promise.all([
    request(rustplus, "getInfo", "info"), request(rustplus, "getTime", "time"), request(rustplus, "getMapMarkers", "mapMarkers")
  ]);
  const markerCounts = {};
  for (const marker of markers.markers || []) {
    const type = String(marker.type);
    markerCounts[type] = (markerCounts[type] || 0) + 1;
  }
  const markerTypes = JSON.stringify(Object.fromEntries(Object.entries(markerCounts).sort(([a], [b]) => Number(a) - Number(b))));
  if (markerTypes !== lastMarkerTypes) {
    console.log(`Rust+ map marker types: ${markerTypes}`);
    lastMarkerTypes = markerTypes;
  }
  const currentWipeTime = number(info.wipeTime);
  if (!monumentsLoaded || mapWipeTime !== currentWipeTime) {
    mapWipeTime = currentWipeTime;
    monumentsLoaded = false;
    await loadMonuments(rustplus).catch(error => console.warn("Map monuments unavailable:", error.message));
  }
  return {
    players: number(info.players), maxPlayers: number(info.maxPlayers), queuedPlayers: number(info.queuedPlayers),
    map: String(info.map || "Неизвестна").slice(0, 100), gameTime: clock(time.time), dayPhase: phase(time), events: eventLines(markers),
    wipeStartedAt: currentWipeTime > 0 ? currentWipeTime * 1000 : configuredWipeStartedAt
  };
}

async function sendSnapshot(snapshot) {
  if (process.env.SNAPSHOT_FILE) {
    const target = process.env.SNAPSHOT_FILE;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await fs.rename(temporary, target);
    return;
  }
  const endpoint = new URL("/internal/rustplus/snapshot", process.env.WORKER_URL);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.RUSTPLUS_BRIDGE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(snapshot), signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Worker rejected snapshot: ${response.status} ${await response.text()}`);
}

async function loadReminderState() {
  try { return JSON.parse(await fs.readFile(reminderPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

async function saveReminderState(clock) {
  await fs.mkdir(stateDir, { recursive: true });
  const temporary = `${reminderPath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(clock.snapshot()), "utf8");
  await fs.rename(temporary, reminderPath);
}

function rawRequest(rustplus, body, responseKey) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Rust+ request timed out")), 15_000);
    try {
      rustplus.sendRequest(body, message => {
        clearTimeout(timeout);
        const error = message?.response?.error?.error;
        if (error) reject(new Error(error));
        else if (responseKey && !message?.response?.[responseKey]) reject(new Error(`Rust+ returned no ${responseKey}`));
        else resolve(responseKey ? message.response[responseKey] : message?.response);
        return true;
      });
    } catch (error) { clearTimeout(timeout); reject(error); }
  });
}

function sendChatMessage(rustplus, channel, text) {
  const kind = channel === "clan" ? "sendClanMessage" : "sendTeamMessage";
  return rawRequest(rustplus, { [kind]: { message: text } });
}

async function checkReminders(rustplus, clock) {
  if (reminding || !connected || !selfOnline) return;
  reminding = true;
  try {
    const time = await request(rustplus, "getTime", "time");
    const forecast = clock.observe(time, Date.now());
    await saveReminderState(clock);
    if (!forecast) return;
    const name = forecast.kind === "night" ? "ночи" : "утра";
    const message = `[.int] Напоминание: до ${name} ${formatRemaining(forecast.remainingMinutes)} (сейчас ${gameClock(time.time)}).`;
    for (const channel of ["team", "clan"]) {
      if (channel === "clan" && !clanAvailable) continue;
      if (!clock.shouldRemind(forecast, channel)) continue;
      try {
        await sendChatMessage(rustplus, channel, message);
        clock.markReminded(forecast, channel);
        await saveReminderState(clock);
        console.log(`Sent ${forecast.kind} reminder to Rust ${channel} chat`);
      } catch (error) { console.warn(`Could not send ${forecast.kind} reminder to ${channel} chat: ${error.message}`); }
    }
  } catch (error) { console.warn(`Rust+ day/night reminder check failed: ${error.message}`); }
  finally { reminding = false; }
}

async function poll(rustplus) {
  if (polling || !connected) return;
  polling = true;
  try {
    const now = Date.now();
    const [members, server] = await Promise.all([getTeamInfo(rustplus), getServerStatus(rustplus)]);
    if (process.env.RUSTPLUS_ONLY_WHEN_SELF_ONLINE === '1') {
      const self = members.find(member => member.steamId64 === process.env.RUSTPLUS_PLAYER_ID);
      if (!self?.isOnline) {
        selfOnline = false;
        if (!selfWasOffline) console.log('Paired Steam account is offline on this server; waiting before publishing.');
        selfWasOffline = true;
        return;
      }
      selfWasOffline = false;
    }
    selfOnline = true;
    const { wipeStartedAt, ...publicServer } = server;
    state = updateState(state, members, now, { pollMs, timeZone, wipeStartedAt });
    await saveState();
    await sendSnapshot(toSnapshot(state, process.env.RUSTPLUS_SERVER_ID, process.env.RUSTPLUS_SERVER_NAME || "Rust server", true, now, publicServer));
    console.log(`[${new Date().toISOString()}] ${members.filter(member => member.isOnline).length}/${members.length} team members online`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Poll failed:`, error.message);
  } finally { polling = false; }
}

async function main() {
  await loadState();
  const dayNightClock = new DayNightClock(await loadReminderState());
  const rustplus = new RustPlus(process.env.RUSTPLUS_IP, process.env.RUSTPLUS_PORT, process.env.RUSTPLUS_PLAYER_ID, process.env.RUSTPLUS_PLAYER_TOKEN);
  const handleChat = createTeamChatHandler({
    request: (method, key) => request(rustplus, method, key),
    send: (channel, text) => sendChatMessage(rustplus, channel, text),
    clock: dayNightClock,
    timeZone,
    onError: message => console.error(message)
  });
  rustplus.on("message", packet => { void handleChat(packet); });
  rustplus.on("connected", () => {
    connected = true;
    console.log("Connected to Rust+");
    void rawRequest(rustplus, { getClanInfo: {} }, "clanInfo")
      .then(info => {
        clanAvailable = Boolean(info?.clanInfo?.clanId);
        console.log(clanAvailable ? "Rust+ clan chat available" : "Rust+ clan chat unavailable for this account/server");
      })
      .catch(error => { clanAvailable = false; console.warn(`Rust+ clan chat unavailable: ${error.message}`); });
    void poll(rustplus);
    clearInterval(timer);
    timer = setInterval(() => void poll(rustplus), pollMs);
    clearInterval(reminderTimer);
    reminderTimer = setInterval(() => void checkReminders(rustplus, dayNightClock), 30_000);
  });
  rustplus.on("disconnected", () => {
    connected = false;
    selfOnline = false;
    clanAvailable = false;
    clearInterval(timer);
    clearInterval(reminderTimer);
    console.warn("Disconnected from Rust+; reconnecting in 15 seconds");
    void sendSnapshot(toSnapshot(state, process.env.RUSTPLUS_SERVER_ID, process.env.RUSTPLUS_SERVER_NAME || "Rust server", false)).catch(error => console.error("Disconnected snapshot failed:", error.message));
    clearTimeout(reconnectTimer);
    if (!shuttingDown) reconnectTimer = setTimeout(() => rustplus.connect(), 15_000);
  });
  rustplus.on("error", error => console.error("Rust+ error:", error?.message || error));
  rustplus.connect();
  const shutdown = async () => { shuttingDown = true; clearInterval(timer); clearInterval(reminderTimer); clearTimeout(reconnectTimer); await Promise.all([saveState(), saveReminderState(dayNightClock)]); rustplus.disconnect?.(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => { console.error(error); process.exit(1); });
