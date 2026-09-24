# Rust+ player statistics bridge

This process keeps the Rust+ WebSocket connection open, polls the current in-game team, server time and map events, then sends the data to the Rusticket Worker. It is intentionally separate from Cloudflare Workers because it needs an always-on process.

The Discord card shows team online, tracked play time, total server online/queue, day phase and active Cargo/CH47/patrol helicopter/locked-crate markers. Crates close to Oil Rig monuments are labeled as Oil Rig events. Discord also receives a new message when the day phase changes or a tracked event appears.

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

Double-click `start-on-pc.cmd` (or run `start-on-pc.ps1` in PowerShell). On the first run it copies `.env.example` to the ignored local `.env` and asks for any missing pairing values. Obtain `ip`, `port`, `playerId`, and `playerToken` using the pairing instructions above. The shared `RUSTPLUS_BRIDGE_TOKEN` must already be set to the same value in the Worker. The launcher never uploads `.env` to GitHub and does not display the tokens.

Leave the launcher window open. It waits for `RustClient.exe`/`Rust.exe`, starts the bridge when Rust opens, and stops it after Rust closes. The bridge publishes only when the paired Steam account is online on that server. Data is incomplete while the PC or game is off. Use `start-on-pc.cmd -SetupOnly` to configure without waiting for Rust, or `start-on-pc.cmd -RunNow` for a connection test without launching Rust. Press Ctrl+C to stop. If you do not know the existing Worker secret, `start-on-pc.cmd -NewWorkerSecret -SetupOnly` generates one, saves it to Cloudflare and `.env`, and **rotates** the existing secret: update any other bridge installations before using them again.

This PC launcher requires a deployed Rust+ endpoint in the Cloudflare Worker. If the Worker responds with 404, deploy the current `main` branch first; if it responds with 401, check that `RUSTPLUS_BRIDGE_TOKEN` matches the Worker secret.

### Manual start

```powershell
pnpm install
pnpm start
```

The process writes accumulated player time to `.data/player-stats.json`. Back up this file when moving to another host. The wipe time, map and monuments are detected automatically from Rust+. When `wipeTime` changes, the bridge reloads the map and resets only the wipe counter. `RUSTPLUS_WIPE_STARTED_AT` is an optional fallback for servers that return no wipe time.
