#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
KEY="$(cd "$ROOT/.." && pwd)/Avakado_Setup.pem"
HOST="ec2-15-207-71-192.ap-south-1.compute.amazonaws.com"
ENV_SRC="$ROOT/.env.production"
REMOTE="ubuntu@${HOST}"
HUB_FILE="$ROOT/../.docker-hub-user"
HUB_USER="${DOCKER_HUB_USER:-}"
if [ -z "$HUB_USER" ] && [ -f "$HUB_FILE" ]; then
  HUB_USER="$(tr -d '[:space:]' < "$HUB_FILE")"
fi
if [ -z "$HUB_USER" ]; then
  echo "Set DOCKER_HUB_USER or write your Docker Hub username to $HUB_FILE" >&2
  exit 1
fi

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

SHA="$(git rev-parse --short HEAD)"
IMAGE="$HUB_USER/ava-saas:$SHA"
docker build --platform linux/amd64 -t "$IMAGE" -t "$HUB_USER/ava-saas:prod" .
docker push "$IMAGE"
docker push "$HUB_USER/ava-saas:prod"

scp -i "$KEY" -o IdentitiesOnly=yes "$ROOT/docker-compose.yml" "${REMOTE}:~/Ava_SAAS/docker-compose.yml"
scp -i "$KEY" -o IdentitiesOnly=yes "$ENV_SRC" "${REMOTE}:~/Ava_SAAS/.env"

ssh -i "$KEY" -o IdentitiesOnly=yes "$REMOTE" "AVA_IMAGE='$IMAGE' bash -s" <<'EOF'
set -euo pipefail
chmod 600 ~/Ava_SAAS/.env
cd ~/Ava_SAAS
docker compose pull
docker compose up -d --no-build --force-recreate --pull always
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/ >/dev/null && curl -fsS http://127.0.0.1:3002/ >/dev/null; then
    echo "healthy"
    exit 0
  fi
  sleep 3
done
echo "health check failed" >&2
docker compose logs --tail 50
exit 1
EOF
