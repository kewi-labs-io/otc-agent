#!/usr/bin/env bash
set -euo pipefail

PORT=${POSTGRES_DEV_PORT:-5439}
NAME=eliza-postgres
IMAGE=pgvector/pgvector:pg16

if nc -z localhost "$PORT" >/dev/null 2>&1; then
  echo "[PG] Postgres already listening on port $PORT"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[PG] Docker is not installed. Please install Docker or set POSTGRES_URL" >&2
  exit 0
fi

EXISTS=$(docker ps -a --filter name=^/${NAME}$ --format '{{.Names}}' || true)
if [ "$EXISTS" != "$NAME" ]; then
  echo "[PG] Creating container $NAME on port $PORT"
  docker run -d --name "$NAME" \
    -e POSTGRES_PASSWORD=password \
    -e POSTGRES_USER=eliza \
    -e POSTGRES_DB=eliza \
    -p "$PORT:5432" "$IMAGE" >/dev/null
else
  CURRENT_IMAGE=$(docker inspect --format='{{.Config.Image}}' "$NAME" 2>/dev/null || echo "")
  if [[ "$CURRENT_IMAGE" != "$IMAGE" ]]; then
    echo "[PG] Recreating $NAME with image $IMAGE (was $CURRENT_IMAGE)"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" \
      -e POSTGRES_PASSWORD=password \
      -e POSTGRES_USER=eliza \
      -e POSTGRES_DB=eliza \
      -p "$PORT:5432" "$IMAGE" >/dev/null
  else
    echo "[PG] Starting existing container $NAME"
    docker start "$NAME" >/dev/null
  fi
fi

echo -n "[PG] Waiting for Postgres to be ready"
for i in {1..30}; do
  if nc -z localhost "$PORT" >/dev/null 2>&1; then
    echo " - ready"
    # Ensure pgvector extension is available in the 'eliza' database
    docker exec "$NAME" psql -U postgres -d eliza -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || true
    exit 0
  fi
  echo -n "."
  sleep 1
done
echo "\n[PG] Postgres did not become ready in time" >&2
exit 0


