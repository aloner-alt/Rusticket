const fs = require("node:fs");
const path = require("node:path");

function parsePairing(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    try { return parsePairing(JSON.parse(value), depth + 1); }
    catch { return null; }
  }
  if (typeof value !== "object") return null;
  const pairing = {
    ip: String(value.ip ?? ""),
    port: String(value.port ?? ""),
    playerId: String(value.playerId ?? ""),
    playerToken: String(value.playerToken ?? "")
  };
  if (value.type === "server" && /^[a-zA-Z0-9.:-]+$/.test(pairing.ip)
    && /^\d{2,5}$/.test(pairing.port) && Number(pairing.port) <= 65535
    && /^\d{17,20}$/.test(pairing.playerId) && /^-?\d+$/.test(pairing.playerToken)) {
    return { ...pairing, name: String(value.name ?? "Rust server").slice(0, 80) };
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = parsePairing(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function quote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function savePairing(envPath, pairing) {
  const examplePath = path.join(__dirname, "..", ".env.example");
  const previous = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(examplePath, "utf8");
  const values = {
    RUSTPLUS_IP: pairing.ip,
    RUSTPLUS_PORT: pairing.port,
    RUSTPLUS_PLAYER_ID: pairing.playerId,
    RUSTPLUS_PLAYER_TOKEN: pairing.playerToken,
    RUSTPLUS_SERVER_NAME: pairing.name,
    RUSTPLUS_ONLY_WHEN_SELF_ONLINE: "1"
  };
  let updated = previous;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${quote(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    updated = pattern.test(updated) ? updated.replace(pattern, line) : `${updated.trimEnd()}\n${line}\n`;
  }
  const tempPath = `${envPath}.tmp`;
  fs.writeFileSync(tempPath, updated, { mode: 0o600 });
  fs.renameSync(tempPath, envPath);
}

async function listenForPairing(configPath, envPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const gcm = config.fcm_credentials?.gcm;
  if (!gcm?.androidId || !gcm?.securityToken) throw new Error("Rust+ registration is missing; run fcm-register first.");
  const PushReceiverClient = require("@rustwirebot/rustplus.js/vendor/push-receiver/client");
  const client = new PushReceiverClient(gcm.androidId, gcm.securityToken, []);
  let completed = false;
  client.on("connect", () => console.log("Rust+ notification listener connected. In Rust, click Pair with Server."));
  client.on("disconnect", () => console.log("Rust+ notification listener disconnected; reconnecting..."));
  client.on("error", error => console.error(`Notification listener: ${error.message}`));
  client.on("ON_DATA_RECEIVED", data => {
    if (completed) return;
    const pairing = parsePairing(data);
    if (!pairing) return;
    completed = true;
    try {
      savePairing(envPath, pairing);
      console.log(`Paired with ${pairing.name}. Credentials saved locally; token was not printed.`);
      client.destroy();
      process.exitCode = 0;
    } catch (error) {
      console.error(`Could not save pairing: ${error.message}`);
      process.exitCode = 1;
      client.destroy();
    }
  });
  await client.connect();
}

if (require.main === module) {
  const [configPath, envPath] = process.argv.slice(2);
  if (!configPath || !envPath) throw new Error("Usage: node pairing.cjs <rustplus.config.json> <.env>");
  listenForPairing(configPath, envPath).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { parsePairing, savePairing };
