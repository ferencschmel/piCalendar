#!/usr/bin/env bash
#
# One-shot provisioning for a fresh Raspberry Pi. Idempotent: safe to re-run.
#
#   curl -fsSL .../install.sh | sudo bash          # or
#   sudo ./deploy/install.sh
#
set -euo pipefail

APP_USER="${APP_USER:-picalendar}"
APP_DIR="${APP_DIR:-/opt/picalendar}"
DATA_DIR="${DATA_DIR:-/var/lib/picalendar}"
CONF_DIR="${CONF_DIR:-/etc/picalendar}"
REPO_URL="${REPO_URL:-https://github.com/your-user/piCalendar.git}"
NODE_MAJOR="${NODE_MAJOR:-22}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "This script must run as root (use sudo)." >&2
  exit 1
fi

log "Installing OS packages"
apt-get update -qq
# build-essential and python3 are needed only if npm has to compile
# better-sqlite3 from source; on arm64 a prebuilt binary is usually available.
apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v), npm $(npm -v)"

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating service user ${APP_USER}"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

log "Preparing directories"
mkdir -p "$APP_DIR" "$DATA_DIR" "$CONF_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
  log "Cloning ${REPO_URL}"
  sudo -u "$APP_USER" git clone --depth 1 "$REPO_URL" "$APP_DIR"
else
  log "Updating existing checkout"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi

log "Installing dependencies and building"
# Built on the Pi so better-sqlite3 links against this machine's architecture.
sudo -u "$APP_USER" npm --prefix "$APP_DIR" ci
sudo -u "$APP_USER" npm --prefix "$APP_DIR" run build

if [[ ! -f "$CONF_DIR/picalendar.env" ]]; then
  log "Writing default configuration to ${CONF_DIR}/picalendar.env"
  install -m 0640 -o root -g "$APP_USER" "$APP_DIR/.env.example" "$CONF_DIR/picalendar.env"
  sed -i "s|^DATABASE_PATH=.*|DATABASE_PATH=${DATA_DIR}/picalendar.sqlite|" "$CONF_DIR/picalendar.env"
  sed -i "s|^STATIC_DIR=.*|STATIC_DIR=${APP_DIR}/apps/frontend/dist|" "$CONF_DIR/picalendar.env"
  # Default the display zone to whatever the Pi is already set to.
  sed -i "s|^DISPLAY_TIMEZONE=.*|DISPLAY_TIMEZONE=$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)|" \
    "$CONF_DIR/picalendar.env"
else
  log "Keeping existing ${CONF_DIR}/picalendar.env"
fi

log "Applying database migrations"
sudo -u "$APP_USER" env $(grep -v '^#' "$CONF_DIR/picalendar.env" | xargs) \
  node "$APP_DIR/apps/backend/dist/db/migrate-cli.js"

log "Installing systemd unit"
install -m 0644 "$APP_DIR/deploy/picalendar.service" /etc/systemd/system/picalendar.service
systemctl daemon-reload
systemctl enable picalendar
systemctl restart picalendar

log "Done. Dashboard: http://$(hostname -I | awk '{print $1}'):4000/"
log "Follow logs with: journalctl -u picalendar -f"
