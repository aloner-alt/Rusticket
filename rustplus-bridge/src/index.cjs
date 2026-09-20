require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const RustPlus = require("@rustwirebot/rustplus.js");
const { updateState, toSnapshot } = require("./tracker.cjs");

const required = ["RUSTPLUS_IP", "RUSTPLUS_PORT", "RUSTPLUS_PLAYER_ID", "RUSTPLUS_PLAYER_TOKEN", "WORKER_URL", "RUSTPLUS_BRIDGE_TOKEN"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);

const pollSeconds = Math.max(30, Number(process.env.POLL_SECONDS || 60));
const pollMs = pollSeconds * 1000;
const timeZone = process.env.TIME_ZONE || "Europe/Moscow";
const wipeStartedAt = process.env.RUSTPLUS_WIPE_STARTED_AT ? Date.parse(process.env.RUSTPLUS_WIPE_STARTED_AT) : undefined;
if (process.env.RUSTPLUS_WIPE_STARTED_AT && !Number.isFinite(wipeStartedAt)) throw new Error("RUSTPLUS_WIPE_STARTED_AT must be an ISO date");
const stateDir = path.join(__dirname, "..", ".data");
const statePath = path.join(stateDir, "player-stats.json");
let state = { version: 1, players: {} };
let timer;
let reconnectTimer;
let polling = false;
let connected = false;
let shuttingDown = false;

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

async function sendSnapshot(snapshot) {
  const endpoint = new URL("/internal/rustplus/snapshot", process.env.WORKER_URL);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.RUSTPLUS_BRIDGE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(snapshot), signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Worker rejected snapshot: ${response.status} ${await response.text()}`);
}

async function poll(rustplus) {
  if (polling || !connected) return;
  polling = true;
  try {
    const now = Date.now();
    const members = await getTeamInfo(rustplus);
    state = updateState(state, members, now, { pollMs, timeZone, wipeStartedAt });
    await saveState();
    await sendSnapshot(toSnapshot(state, process.env.RUSTPLUS_SERVER_NAME || "Rust server", true, now));
    console.log(`[${new Date().toISOString()}] ${members.filter(member => member.isOnline).length}/${members.length} team members online`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Poll failed:`, error.message);
  } finally { polling = false; }
}

async function main() {
  await loadState();
  const rustplus = new RustPlus(process.env.RUSTPLUS_IP, process.env.RUSTPLUS_PORT, process.env.RUSTPLUS_PLAYER_ID, process.env.RUSTPLUS_PLAYER_TOKEN);
  rustplus.on("connected", () => {
    connected = true;
    console.log("Connected to Rust+");
    void poll(rustplus);
    clearInterval(timer);
    timer = setInterval(() => void poll(rustplus), pollMs);
  });
  rustplus.on("disconnected", () => {
    connected = false;
    console.warn("Disconnected from Rust+; reconnecting in 15 seconds");
    void sendSnapshot(toSnapshot(state, process.env.RUSTPLUS_SERVER_NAME || "Rust server", false)).catch(error => console.error("Disconnected snapshot failed:", error.message));
    clearTimeout(reconnectTimer);
    if (!shuttingDown) reconnectTimer = setTimeout(() => rustplus.connect(), 15_000);
  });
  rustplus.on("error", error => console.error("Rust+ error:", error?.message || error));
  rustplus.connect();
  const shutdown = async () => { shuttingDown = true; clearInterval(timer); clearTimeout(reconnectTimer); await saveState(); rustplus.disconnect?.(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => { console.error(error); process.exit(1); });
