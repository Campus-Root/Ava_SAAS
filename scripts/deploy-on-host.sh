#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${HOME}/Ava_SAAS"

mkdir -p "$APP"
rsync -a --delete \
  --filter 'protect .env' \
  --filter 'protect .env.*' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.pem' \
  "$ROOT/" "$APP/"

if [ -z "${ENV_FILE:-}" ]; then
  echo "ENV_FILE is empty. Refusing to overwrite ${APP}/.env" >&2
  exit 1
fi
printf '%s\n' "$ENV_FILE" > "$APP/.env"
chmod 600 "$APP/.env"

cd "$APP"
docker compose up -d --build --force-recreate

PORT="$(sed -n 's/^PORT=//p' "$APP/.env" | head -1 | tr -d ' \"')"
PORT="${PORT:-3000}"

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null; then
    echo "healthy"
    exit 0
  fi
  sleep 3
done

echo "health check failed" >&2
docker compose logs --tail 50
exit 1
