#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL cluster (no Docker needed).
# Usage: scripts/dev-db.sh start|stop     (PGPORT overrides the port, default 5432)
set -euo pipefail
PORT="${PGPORT:-5432}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
export PATH="$BIN:$PATH"
if [ "$(id -u)" = "0" ]; then
  # Postgres refuses to run as root; delegate to the postgres system user.
  DIR="/tmp/imta-pgdata"
  RUN="runuser -u postgres --"
  mkdir -p "$DIR" && chown postgres "$DIR"
else
  DIR="$(cd "$(dirname "$0")/.." && pwd)/.pgdata"
  RUN=""
fi
case "${1:-start}" in
  start)
    if [ ! -f "$DIR/PG_VERSION" ]; then
      $RUN "$BIN/initdb" -D "$DIR" -U imta --auth=trust >/dev/null
    fi
    $RUN "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp" -l "$DIR/log" start >/dev/null
    "$BIN/createdb" -h /tmp -p "$PORT" -U imta imta 2>/dev/null || true
    echo "postgres://imta:imta@localhost:$PORT/imta"
    ;;
  stop) $RUN "$BIN/pg_ctl" -D "$DIR" stop >/dev/null ;;
  *) echo "usage: $0 start|stop"; exit 1 ;;
esac
