#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 24.04 server (UpCloud, Hetzner, ...).
# Run as root:  curl -fsSL https://raw.githubusercontent.com/bravestarfish/imta/main/scripts/bootstrap-server.sh | bash
# Then edit /opt/imta/.env and run: cd /opt/imta && docker compose up -d --build && docker compose run --rm worker pnpm db:migrate
set -euo pipefail
REPO="${IMTA_REPO:-https://github.com/bravestarfish/imta.git}"
BRANCH="${IMTA_BRANCH:-main}"
DIR="${IMTA_DIR:-/opt/imta}"

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw unattended-upgrades

echo "== docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

echo "== firewall (ssh, http, https)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== code"
if [ ! -d "$DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$DIR"
else
  git -C "$DIR" pull --ff-only
fi
cd "$DIR"

echo "== secrets"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
  sed -i "s|^WEBHOOK_SECRET=.*|WEBHOOK_SECRET=$(openssl rand -hex 24)|" .env
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
  echo "DOMAIN=imta.rsvp" >> .env
  echo "== generating ATProto signing key (takes a minute: builds the worker image)"
  docker compose build worker >/dev/null
  KEY=$(docker compose run --rm --no-deps worker pnpm --silent keygen | tail -1)
  sed -i "s|^ATPROTO_PRIVATE_KEY_1=.*|ATPROTO_PRIVATE_KEY_1='$KEY'|" .env
  echo "Wrote $DIR/.env with generated secrets. Fill in SMTP_URL, GOOGLE_*, MICROSOFT_*, ZOOM_* then run:"
  echo "  cd $DIR && docker compose up -d --build && docker compose run --rm worker pnpm db:migrate"
else
  echo ".env exists, leaving it alone"
fi
