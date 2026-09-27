# Rust+ player statistics bridge

This process keeps the Rust+ WebSocket connection open, polls the current in-game team, server time and map events, then sends the data to the Rusticket Worker. It is intentionally separate from Cloudflare Workers because it needs an always-on process.

The Discord card shows team online, tracked play time, total server online/queue, day phase and active Cargo/CH47/patrol helicopter/locked-crate markers. Crates close to Oil Rig monuments are labeled as Oil Rig events. Discord also receives a new message when the day phase changes or a tracked event appears.

## Rust team-chat commands

While the bridge is connected, any teammate can type these commands in the **Rust team chat or native Rust+ clan chat** (not global chat or Discord). The reply appears in the same chat with a `[.int]` prefix. Clan chat requires the paired account to belong to a clan supported by the server's Rust+ API; a server-side modded clan channel may not be exposed there. Commands have an 8-second per-player and 2-second global cooldown; duplicate broadcasts and the bot's own replies are ignored.

`-help`, `-time`/`-время`, `-верт`/`-heli`, `-cargo`/`-карго`, `-ch47`, `-crate`/`-ящики`, `-events`/`-события`, `-online`/`-команда`, `-pop`/`-онлайн`, `-wipe`/`-вайп`.

`CH47` is the transport helicopter (Chinook), `-события` is a summary of current Rust+ map markers, and `-ящики` counts locked hackable-crate markers. Event commands report only markers currently returned through Rust+; a missing marker does not prove the event is absent in the game. They do not claim an exact respawn timer or show events hidden by the server. Marker type counts are logged when they change for troubleshooting. The PC launcher stops this feature when Rust closes.

`-time` reports the in-game clock and the approximate **real minutes** until the next sunset or sunrise. The bridge measures the server's actual clock speed separately for day and night instead of assuming a vanilla cycle. It checks the time every 30 seconds and sends one reminder when the next transition is within five real minutes, to both team and available native clan chat. After a restart, it needs two time samples to calibrate; reminder delivery flags are persisted in `.data/day-night-reminders.json` to prevent repeats in the same cycle. No reminders are sent while the paired player is offline or the Rust+ connection is down.

## Pair the Steam account

On the Windows PC with Chrome and Rust installed:

```powershell
npx @rustwirebot/rustplus.js fcm-register
npx @rustwirebot/rustplus.js fcm-listen
```

Join the Rust server, open the Rust+ menu and press **Pair with Server**. Copy only `ip`, `port`, `playerId` and `playerToken` from the pairing notification into a local `.env` copied from `.env.example`. Set a stable `RUSTPLUS_SERVER_ID` such as `mirage-main`. Never commit that file or send it in a public channel.

## Worker secret

Generate one random shared secret and set the same value in both places:

```powershell
npx wrangler secret put RUSTPLUS_BRIDGE_TOKEN
```

Set the value as `RUSTPLUS_BRIDGE_TOKEN` in the bridge `.env`. The Worker accepts snapshots only with this secret.

## Run with Docker

On the host, clone the branch and create the private configuration:

```bash
git clone --branch feature/rustplus-player-stats https://github.com/aloner-alt/Rusticket.git
cd Rusticket/rustplus-bridge
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f
```

The host does not need a Steam login or password. It only needs the four pairing values. Treat `playerToken` as a password.

For a second Rust server, pair it separately, create `.env.server2` with another unique `RUSTPLUS_SERVER_ID`, and start another Compose project:

```bash
docker compose --env-file .env.server2 -p rusticket-server2 up -d --build
```

Each Compose project receives its own persistent statistics volume and its own Discord status card.

## Run without Docker

### Windows: one-click launcher while playing

For Docker Desktop on the same PC, run `start-docker-on-pc.cmd`. On the first run it installs the local Node dependencies if needed, finds Microsoft Edge or Chrome for one-time Steam/Rust+ authorization, and waits for you to join the desired server and click **Pair with Server** in Rust. The launcher captures the pairing notification, creates the ignored `.env` automatically, generates a new shared Cloudflare Worker secret, and starts the Docker Compose bridge while Rust is running. No pairing values or tokens need to be typed or copied. Leave the launcher window open; it stops the container when Rust closes, and Ctrl+C stops both. Later runs reuse the saved pairing and secret. The one-time secret generation replaces the previous Worker secret, so any other Rust+ bridge using the old secret must be updated. Docker Desktop, Node.js 20+, Edge or Chrome, and Wrangler authorization are prerequisites. Firefox alone cannot complete the current library's Steam pairing flow. Steam authorization and the in-game Pair button cannot be automated by the launcher.

The PC Docker launcher uses Compose project `rusticket-pc`, a separate persistent statistics volume, and a `restart: no` override so Docker does not keep this container alive when the launcher stops. It only publishes while your paired Steam account is online on that server. If Docker Desktop is installed but not running, the launcher starts it and waits for its Linux engine.

Double-click `start-on-pc.cmd` (or run `start-on-pc.ps1` in PowerShell). On the first run it copies `.env.example` to the ignored local `.env` and asks for any missing pairing values. Obtain `ip`, `port`, `playerId`, and `playerToken` using the pairing instructions above. The shared `RUSTPLUS_BRIDGE_TOKEN` must already be set to the same value in the Worker. The launcher never uploads `.env` to GitHub and does not display the tokens.

Leave the launcher window open. It waits for `RustClient.exe`/`Rust.exe`, starts the bridge when Rust opens, and stops it after Rust closes. The bridge publishes only when the paired Steam account is online on that server. Data is incomplete while the PC or game is off. Use `start-on-pc.cmd -SetupOnly` to configure without waiting for Rust, or `start-on-pc.cmd -RunNow` for a connection test without launching Rust. Press Ctrl+C to stop. If you do not know the existing Worker secret, `start-on-pc.cmd -NewWorkerSecret -SetupOnly` generates one, saves it to Cloudflare and `.env`, and **rotates** the existing secret: update any other bridge installations before using them again.

This PC launcher requires a deployed Rust+ endpoint in the Cloudflare Worker. If the Worker responds with 404, deploy the current `main` branch first; if it responds with 401, check that `RUSTPLUS_BRIDGE_TOKEN` matches the Worker secret.

### Manual start

```powershell
pnpm install
pnpm start
```

The process writes accumulated player time to `.data/player-stats.json`. Back up this file when moving to another host. The wipe time, map and monuments are detected automatically from Rust+. When `wipeTime` changes, the bridge reloads the map and resets only the wipe counter. `RUSTPLUS_WIPE_STARTED_AT` is an optional fallback for servers that return no wipe time.
