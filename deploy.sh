#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
KEY="$(cd "$ROOT/.." && pwd)/Avakado_Setup.pem"
HOST="ec2-15-207-71-192.ap-south-1.compute.amazonaws.com"
ENV_SRC="$ROOT/.env.production"
REMOTE="ubuntu@${HOST}"

if [ ! -f "$ENV_SRC" ]; then
  echo "Missing $ENV_SRC" >&2
  exit 1
fi

cd "$ROOT"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "in prod"
fi
git push origin HEAD

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.pem' \
  -e "ssh -i ${KEY} -o IdentitiesOnly=yes" \
  "$ROOT/" "${REMOTE}:~/Ava_SAAS/"

scp -i "$KEY" -o IdentitiesOnly=yes "$ENV_SRC" "${REMOTE}:~/Ava_SAAS/.env"

ssh -i "$KEY" -o IdentitiesOnly=yes "$REMOTE" bash -s <<'EOF'
set -euo pipefail
chmod 600 ~/Ava_SAAS/.env
cd ~/Ava_SAAS
docker compose up -d --build --force-recreate
PORT="$(sed -n 's/^PORT=//p' .env | head -1 | tr -d ' "')"
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
EOF
