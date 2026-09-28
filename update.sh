#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
cd /opt/rusticket
if [[ $EUID -eq 0 ]]; then
  echo 'Run as aloner (Docker access is requested through sudo).' >&2
  exit 1
fi
if [[ ! -f .env || ! -f rustplus-bridge/.env ]]; then
  echo 'Missing .env file; refusing to update.' >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Tracked files have local changes; resolve them before updating.' >&2
  exit 1
fi
backup_dir=$(mktemp -d /opt/rusticket/.env-backup.XXXXXXXX)
chmod 700 "$backup_dir"
cp -p .env "$backup_dir/root.env"
cp -p rustplus-bridge/.env "$backup_dir/bridge.env"
echo "Environment backup: $backup_dir"
git pull --ff-only
if ! cmp -s .env "$backup_dir/root.env" || ! cmp -s rustplus-bridge/.env "$backup_dir/bridge.env"; then
  cp -p "$backup_dir/root.env" .env
  cp -p "$backup_dir/bridge.env" rustplus-bridge/.env
  echo 'Environment files restored from backup.'
fi
python3 - <<'PY'
from pathlib import Path
p=Path('rustplus-bridge/.env')
values={k:v for line in p.read_text().splitlines() if '=' in line and not line.lstrip().startswith('#') for k,v in [line.split('=',1)]}
required=('RUSTPLUS_SERVER_ID','RUSTPLUS_IP','RUSTPLUS_PORT','RUSTPLUS_PLAYER_ID','RUSTPLUS_PLAYER_TOKEN','WORKER_URL','RUSTPLUS_BRIDGE_TOKEN')
missing=[key for key in required if not values.get(key,'').strip().strip('"\'') or 'REPLACE' in values.get(key,'') or 'YOUR_' in values.get(key,'')]
if missing:
    raise SystemExit('Fill required bridge variables: '+', '.join(missing))
PY
if [[ $EUID -eq 0 ]]; then docker=(docker); else docker=(sudo docker); fi
"${docker[@]}" compose -f rustplus-bridge/compose.yaml -f rustplus-bridge/compose.local.yaml --project-directory rustplus-bridge build
"${docker[@]}" compose -f rustplus-bridge/compose.yaml -f rustplus-bridge/compose.local.yaml --project-directory rustplus-bridge up -d
"${docker[@]}" compose -f rustplus-bridge/compose.yaml -f rustplus-bridge/compose.local.yaml --project-directory rustplus-bridge ps
