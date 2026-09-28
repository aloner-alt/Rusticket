# Gateway deployment

The server uses the existing `handleInteraction` business logic. Gateway `INTERACTION_CREATE` events are sent to it unchanged, and its Web API response is posted to Discord's interaction callback REST endpoint. Existing `editOriginalResponse` and `createFollowupResponse` use the interaction webhook REST endpoints for deferred work. The Cloudflare Worker keeps its signed HTTP webhook path.

The container serves only `GET /health`. Compose publishes port 3000 on the host loopback address `127.0.0.1` for local checks; it does not expose the port to the internet. `DISCORD_GATEWAY_ENABLED=false` is the default: SQLite and health run, while Gateway, scheduled tasks, and Rust+ snapshot ingestion stay off. No domain or Cloudflare Tunnel is needed.

Production startup refuses a missing or empty KV migration. The initial production export and import use `sudo /opt/rusticket/server/export-import-kv.sh`. It reads Cloudflare credentials interactively without echo, stores the complete export outside Git in a root-only directory, and imports into the `rusticket-data` volume. It refuses a repeated import. Keep `/opt/rusticket/.env` private with mode 600.

The server starts in health-only mode with `DISCORD_GATEWAY_ENABLED=false`:

```bash
cd /opt/rusticket
sudo docker compose -f compose.server.yaml up -d
curl -fsS http://127.0.0.1:3000/health
```

Keep the current Worker active until final approval. At cutover, first stop Worker processing, clear Interactions Endpoint URL in Discord Developer Portal, then run `sudo docker compose -f compose.server.yaml up -d`, check container health and `/setup-recruitment` plus buttons, and restart `rusticket-server-agent`. The current 126-key import is a staging copy. A final KV synchronization procedure is required at cutover after Worker writes stop, before enabling Gateway, because the Worker may change KV meanwhile. Do not rerun the initial importer over the migrated database.

## Rust+ bridge after cutover

The running bridge currently posts snapshots to the Worker. For Gateway mode, add `rustplus-bridge/compose.gateway.yaml` to the existing bridge Compose invocation. This sets `SNAPSHOT_FILE` and makes the bridge atomically write snapshots to its existing persistent `/app/.data` volume. Rusticket mounts that volume read-only and sends each new snapshot through the existing Rust+ processing function. The bridge container must be rebuilt and recreated with the overlay at cutover; do not do that while the Worker is still the active Rusticket endpoint. Example:

```bash
cd /opt/rusticket/rustplus-bridge
sudo docker compose -f compose.yaml -f compose.local.yaml -f compose.gateway.yaml up -d --build
```

The local file mode does not require a public HTTP route or a tunnel. The old Worker POST mode remains available when `SNAPSHOT_FILE` is unset.
