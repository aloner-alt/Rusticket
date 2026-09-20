# Rust+ player statistics bridge

This process keeps the Rust+ WebSocket connection open, polls the current in-game team and sends accumulated play time to the Rusticket Worker. It is intentionally separate from Cloudflare Workers because it needs an always-on process.

## Pair the Steam account

On the Windows PC with Chrome and Rust installed:

```powershell
npx @rustwirebot/rustplus.js fcm-register
npx @rustwirebot/rustplus.js fcm-listen
```

Join the Rust server, open the Rust+ menu and press **Pair with Server**. Copy only `ip`, `port`, `playerId` and `playerToken` from the pairing notification into a local `.env` copied from `.env.example`. Never commit that file.

## Worker secret

Generate one random shared secret and set the same value in both places:

```powershell
npx wrangler secret put RUSTPLUS_BRIDGE_TOKEN
```

Set the value as `RUSTPLUS_BRIDGE_TOKEN` in the bridge `.env`. The Worker accepts snapshots only with this secret.

## Run

```powershell
pnpm install
pnpm start
```

The process writes accumulated player time to `.data/player-stats.json`. Back up this file when moving to another host. Set `RUSTPLUS_WIPE_STARTED_AT` to the wipe start in ISO format, for example `2026-09-24T18:00:00+03:00`; changing it starts a new wipe counter without deleting total tracked time.
