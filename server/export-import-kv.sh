#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

project=/opt/rusticket
private_dir=/var/lib/rusticket/kv-export
image=rusticket-rusticket:latest

if [[ $EUID -ne 0 || ! -t 0 ]]; then
  printf 'Run interactively with sudo.\n' >&2
  exit 1
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf 'Build the Rusticket image first.\n' >&2
  exit 1
fi

if docker volume inspect rusticket-data >/dev/null 2>&1; then
  already_imported=$(docker run --rm --network none -v rusticket-data:/data "$image" node -e '
    const fs = require("node:fs");
    if (!fs.existsSync("/data/rusticket.sqlite")) process.exit(0);
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync("/data/rusticket.sqlite", { readOnly: true });
    if (db.prepare("SELECT value FROM migration WHERE name = ?").get("complete")) console.log("YES");
    db.close();
  ' 2>/dev/null) || already_imported=''
  if [[ $already_imported == YES ]]; then
    printf 'KV migration already complete; do not re-import.\n' >&2
    exit 1
  fi
fi

IFS= read -r -s -p 'CF_ACCOUNT_ID: ' cf_account_id </dev/tty
printf '\n' >&2
IFS= read -r -s -p 'CF_API_TOKEN (Workers KV Storage Read): ' cf_api_token </dev/tty
printf '\n' >&2
trap 'unset cf_account_id cf_api_token' EXIT
if [[ ! $cf_account_id =~ ^[0-9a-fA-F]{32}$ || -z $cf_api_token ]]; then
  printf 'Invalid or empty Cloudflare credentials.\n' >&2
  exit 1
fi

install -d -o root -g root -m 700 "$private_dir"
file_name="kv-production-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
snapshot="$private_dir/$file_name"

if ! printf '%s\n%s\n' "$cf_account_id" "$cf_api_token" | docker run --rm -i \
  --cap-drop ALL --security-opt no-new-privileges:true --read-only --tmpfs /tmp:mode=1777 \
  -v "$project/server/export-cloudflare-kv.mjs:/app/server/export-cloudflare-kv.mjs:ro" \
  -v "$project/wrangler.toml:/app/wrangler.toml:ro" \
  -v "$private_dir:/export" \
  node:24-bookworm-slim sh -c '
    IFS= read -r CF_ACCOUNT_ID
    IFS= read -r CF_API_TOKEN
    export CF_ACCOUNT_ID CF_API_TOKEN
    exec node /app/server/export-cloudflare-kv.mjs "/export/$1"
  ' sh "$file_name" >/dev/null 2>&1; then
  printf 'KV_EXPORT=FAIL\n' >&2
  exit 1
fi
unset cf_account_id cf_api_token
chmod 600 "$snapshot"

exported_count=$(python3 - "$snapshot" "$project/wrangler.toml" <<'PY'
import json, re, sys
from pathlib import Path
snapshot=json.loads(Path(sys.argv[1]).read_text())
namespace=re.search(r'^id\s*=\s*"([a-f0-9]+)"',Path(sys.argv[2]).read_text(),re.M).group(1)
entries=snapshot.get('entries')
if snapshot.get('complete') is not True or snapshot.get('namespaceId')!=namespace or not isinstance(entries,list) or not entries:
    raise SystemExit(1)
print(len(entries))
PY
) || { printf 'KV_EXPORT_VALIDATION=FAIL\n' >&2; exit 1; }

docker volume create rusticket-data >/dev/null
if ! docker run --rm --network none --security-opt no-new-privileges:true \
  -v rusticket-data:/data -v "$snapshot:/snapshot.json:ro" \
  --user root "$image" sh -c 'pnpm exec tsx server/import-kv.ts /snapshot.json && chown -R node:node /data' >/dev/null 2>&1; then
  printf 'KV_IMPORT=FAIL; export retained privately\n' >&2
  exit 1
fi

imported_count=$(docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges:true \
  -v rusticket-data:/data "$image" node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync("/data/rusticket.sqlite", { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const journal = db.prepare("PRAGMA journal_mode").get().journal_mode;
    const row = db.prepare("SELECT value FROM migration WHERE name = ?").get("complete");
    const marker = row && JSON.parse(row.value);
    const count = db.prepare("SELECT COUNT(*) AS count FROM kv").get().count;
    db.close();
    if (integrity !== "ok" || journal !== "wal" || !marker || marker.count !== count || count < 1) process.exit(1);
    console.log(count);
  ' 2>/dev/null) || { printf 'SQLITE_CHECK=FAIL\n' >&2; exit 1; }

printf 'EXPORTED_KEYS=%s\nIMPORTED_KEYS=%s\nSQLITE_CHECK=OK\n' "$exported_count" "$imported_count"
