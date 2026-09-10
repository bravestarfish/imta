#!/usr/bin/env bash
# Regenerates ATPROTO_PRIVATE_KEY_1 in .env when it is missing or invalid.
# Run from /opt/imta after `docker compose build worker`.
set -euo pipefail
cd "$(dirname "$0")/.."
CURRENT=$(grep '^ATPROTO_PRIVATE_KEY_1=' .env | cut -d= -f2- | tr -d "'\"")
if [[ "$CURRENT" == \{* ]]; then
  echo "ATPROTO_PRIVATE_KEY_1 already looks valid; leaving it."
  exit 0
fi
KEY=$(docker compose run --rm --no-deps worker pnpm --silent keygen | grep '^{' | tail -1)
[ -n "$KEY" ] || { echo "keygen failed"; exit 1; }
sed -i "s|^ATPROTO_PRIVATE_KEY_1=.*|ATPROTO_PRIVATE_KEY_1='$KEY'|" .env
echo "ATPROTO_PRIVATE_KEY_1 written."
