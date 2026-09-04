#!/usr/bin/env bash
set -Eeuo pipefail

# CineDrive bare-metal installer and updater for Ubuntu/Debian VPS hosts.
# Run as root: bash scripts/install-vps.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# An update can replace this script while Bash is still reading it. Execute a
# private copy so the running installer remains stable across git fast-forwards.
if [[ "${CINEDRIVE_INSTALLER_REEXEC:-}" != "true" ]]; then
  INSTALLER_TEMP_DIR="$(mktemp -d /tmp/cinedrive-installer.XXXXXXXXXX)"
  cp -- "${SCRIPT_DIR}/install-vps.sh" "${INSTALLER_TEMP_DIR}/install-vps.sh"
  cp -- "${SCRIPT_DIR}/install-vps-lib.sh" "${INSTALLER_TEMP_DIR}/install-vps-lib.sh"
  export CINEDRIVE_INSTALLER_REEXEC="true"
  export CINEDRIVE_INSTALLER_TEMP_DIR="$INSTALLER_TEMP_DIR"
  exec bash "${INSTALLER_TEMP_DIR}/install-vps.sh" "$@"
fi

cleanup_installer_copy() {
  if [[ "${CINEDRIVE_INSTALLER_TEMP_DIR:-}" == /tmp/cinedrive-installer.* &&
    -d "$CINEDRIVE_INSTALLER_TEMP_DIR" && ! -L "$CINEDRIVE_INSTALLER_TEMP_DIR" ]]; then
    rm -f -- \
      "${CINEDRIVE_INSTALLER_TEMP_DIR}/install-vps.sh" \
      "${CINEDRIVE_INSTALLER_TEMP_DIR}/install-vps-lib.sh"
    rmdir -- "$CINEDRIVE_INSTALLER_TEMP_DIR" 2>/dev/null || true
  fi
}
trap cleanup_installer_copy EXIT

# shellcheck source=scripts/install-vps-lib.sh
source "${SCRIPT_DIR}/install-vps-lib.sh"

APP_USER="cinedrive"
APP_GROUP="cinedrive"
APP_DIR="/opt/cinedrive"
DATA_DIR="/var/lib/cinedrive"
SYSTEMD_UNIT="/etc/systemd/system/cinedrive.service"
NGINX_SITE="/etc/nginx/sites-enabled/cinedrive"
REPO_URL="${REPO_URL:-https://github.com/yunusemreyazici/CineDrive.git}"
BRANCH="${BRANCH:-main}"
PNPM_VERSION="${PNPM_VERSION:-11.22.0}"

UPDATE_IN_PROGRESS="false"
PREVIOUS_REV=""
TARGET_REV=""
DATABASE_BACKUP=""

update_failure_report() {
  local exit_code="${1:-$?}"
  trap - ERR

  if [[ "$UPDATE_IN_PROGRESS" == "true" ]]; then
    echo >&2
    echo "Güncelleme kurtarma bilgisi:" >&2
    echo "  Önceki commit: ${PREVIOUS_REV:-bilinmiyor}" >&2
    echo "  Hedef commit: ${TARGET_REV:-bilinmiyor}" >&2
    if [[ -n "$DATABASE_BACKUP" ]]; then
      echo "  Migration öncesi snapshot: ${DATABASE_BACKUP}" >&2
    else
      echo "  Migration öncesi snapshot: henüz oluşturulamadı veya veritabanı yoktu" >&2
    fi
    echo "Servisi eski kodla başlatmadan önce docs/OPERATIONS.tr.md içindeki geri dönüş adımlarını izleyin." >&2
  fi

  exit "$exit_code"
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bu script root olarak çalıştırılmalı." >&2
  exit 1
fi

if ! validate_pnpm_version "$PNPM_VERSION"; then
  echo "PNPM_VERSION tam bir sürüm olmalı (ör. 11.22.0)." >&2
  exit 1
fi

exec 9>/run/lock/cinedrive-installer.lock
if ! flock --nonblock 9; then
  echo "Başka bir CineDrive kurulum veya güncelleme işlemi çalışıyor." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Desteklenen bir Debian/Ubuntu sistemi bulunamadı." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
  echo "Bu script yalnızca Ubuntu/Debian için hazırlanmıştır." >&2
  exit 1
fi

prompt_required() {
  local variable_name="$1"
  local prompt="$2"
  local secret="${3:-false}"
  local current_value="${!variable_name:-}"

  while [[ -z "$current_value" ]]; do
    if [[ "$secret" == "true" ]]; then
      read -r -s -p "$prompt: " current_value
      echo
    else
      read -r -p "$prompt: " current_value
    fi
  done

  printf -v "$variable_name" '%s' "$current_value"
}

dotenv_escape() {
  local value="$1"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "Ortam değişkenleri satır sonu içeremez." >&2
    exit 1
  fi
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

read_database_url() {
  local value
  value="$(awk '/^DATABASE_URL=/{sub(/^DATABASE_URL=/, ""); print; exit}' "$APP_DIR/.env")"
  value="${value%$'\r'}"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  if [[ "$value" != file:/* ]]; then
    echo "Production DATABASE_URL mutlak bir SQLite yolu olmalı (file:/...)." >&2
    exit 1
  fi

  printf '%s' "$value"
}

load_database_config() {
  DATABASE_URL="$(read_database_url)"
  DATABASE_PATH="${DATABASE_URL#file:}"
  if [[ "$DATABASE_PATH" == *"'"* ]]; then
    echo "SQLite dosya yolu tek tırnak içeremez." >&2
    exit 1
  fi
}

create_database_backup_if_present() {
  local backup_line
  local backup_output
  local backup_timestamp
  local collision_index

  [[ -f "$DATABASE_PATH" ]] || return 0

  BACKUP_DIR="${DATA_DIR}/backups"
  install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$BACKUP_DIR"
  echo "Migration öncesi doğrulamalı SQLite yedeği alınıyor..."

  if [[ -f "$APP_DIR/apps/server/dist/cli/database-backup.js" ]]; then
    backup_output="$(sudo -u "$APP_USER" -H env DATABASE_URL="$DATABASE_URL" \
      node "$APP_DIR/apps/server/dist/cli/database-backup.js" \
        --output-dir "$BACKUP_DIR" --retain 14)"
    printf '%s\n' "$backup_output"
    while IFS= read -r backup_line; do
      if [[ "$backup_line" == "Database backup created: "* ]]; then
        DATABASE_BACKUP="${backup_line#Database backup created: }"
        break
      fi
    done <<<"$backup_output"
  else
    # Installations predating the backup CLI still need an online, consistent
    # snapshot before their source tree is updated.
    backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    DATABASE_BACKUP="${BACKUP_DIR}/cinedrive-${backup_timestamp}.db"
    collision_index=0
    while [[ -e "$DATABASE_BACKUP" ]]; do
      collision_index=$((collision_index + 1))
      DATABASE_BACKUP="${BACKUP_DIR}/cinedrive-${backup_timestamp}-${collision_index}.db"
    done
    sudo -u "$APP_USER" sqlite3 "$DATABASE_PATH" ".backup '${DATABASE_BACKUP}'"
    if [[ "$(sudo -u "$APP_USER" sqlite3 "$DATABASE_BACKUP" 'PRAGMA integrity_check;')" != "ok" ]]; then
      echo "SQLite fallback snapshot bütünlük kontrolünü geçemedi." >&2
      exit 1
    fi
    chmod 0640 "$DATABASE_BACKUP"
    chown "$APP_USER:$APP_GROUP" "$DATABASE_BACKUP"
    echo "Database backup created: ${DATABASE_BACKUP}"
    echo "Integrity: ok"
  fi

  if [[ -z "$DATABASE_BACKUP" || ! -f "$DATABASE_BACKUP" ]]; then
    echo "Oluşturulan veritabanı snapshot yolu doğrulanamadı." >&2
    exit 1
  fi
}

wait_for_api() {
  systemctl is-active --quiet cinedrive || return 1
  curl --fail --show-error --silent \
    --retry 10 \
    --retry-connrefused \
    --retry-delay 1 \
    http://127.0.0.1:3000/api/ready >/dev/null
}

install_backup_timer() {
  cat >/etc/systemd/system/cinedrive-backup.service <<EOF
[Unit]
Description=CineDrive verified SQLite backup
ConditionPathExists=${DATABASE_PATH}

[Service]
Type=oneshot
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/apps/server/dist/cli/database-backup.js --output-dir ${DATA_DIR}/backups --retain 14
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
UMask=0027
EOF

  cat >/etc/systemd/system/cinedrive-backup.timer <<'EOF'
[Unit]
Description=Create a daily CineDrive database backup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m
Unit=cinedrive-backup.service

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now cinedrive-backup.timer
}

INSTALL_MODE="fresh"
if [[ -d "$APP_DIR/.git" && -f "$APP_DIR/.env" && -f "$SYSTEMD_UNIT" && -e "$NGINX_SITE" ]]; then
  INSTALL_MODE="update"
  echo "Mevcut CineDrive kurulumu bulundu; yapılandırma ve gizli anahtarlar korunacak."
elif [[ -e "$APP_DIR/.git" || -e "$APP_DIR/.env" || -e "$SYSTEMD_UNIT" || -e "$NGINX_SITE" ]]; then
  echo "Yarım kalmış veya tutarsız bir CineDrive kurulumu bulundu." >&2
  echo "Beklenen parçalar: ${APP_DIR}/.git, ${APP_DIR}/.env, ${SYSTEMD_UNIT}, ${NGINX_SITE}." >&2
  echo "Veri kaybını önlemek için kurulum durduruldu." >&2
  exit 1
fi

if [[ "$INSTALL_MODE" == "fresh" ]]; then
  prompt_required DOMAIN "Alan adı (ör. film.example.com)"
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"
  DOMAIN="${DOMAIN,,}"

  if ! validate_domain "$DOMAIN"; then
    echo "Geçerli, DNS kaydı bu VPS'ye yönlendirilmiş bir alan adı girin." >&2
    exit 1
  fi

  while true; do
    if [[ -z "${TLS_MODE:-}" ]]; then
      read -r -p "TLS modu [cloudflare/certbot/http] (varsayılan: cloudflare): " TLS_MODE
      TLS_MODE="${TLS_MODE:-cloudflare}"
    fi
    case "$TLS_MODE" in
      cloudflare | certbot | http) break ;;
      *)
        echo "TLS modu cloudflare, certbot veya http olmalı." >&2
        TLS_MODE=""
        ;;
    esac
  done

  if [[ "$TLS_MODE" == "cloudflare" ]]; then
    CLOUDFLARE_CERT_PATH="${CLOUDFLARE_CERT_PATH:-/etc/ssl/cloudflare/cinedrive.pem}"
    CLOUDFLARE_KEY_PATH="${CLOUDFLARE_KEY_PATH:-/etc/ssl/cloudflare/cinedrive.key}"
    read -r -p "Cloudflare Origin Certificate yolu [${CLOUDFLARE_CERT_PATH}]: " input_cert_path
    read -r -p "Cloudflare private key yolu [${CLOUDFLARE_KEY_PATH}]: " input_key_path
    CLOUDFLARE_CERT_PATH="${input_cert_path:-$CLOUDFLARE_CERT_PATH}"
    CLOUDFLARE_KEY_PATH="${input_key_path:-$CLOUDFLARE_KEY_PATH}"

    if ! validate_nginx_path "$CLOUDFLARE_CERT_PATH" ||
      ! validate_nginx_path "$CLOUDFLARE_KEY_PATH"; then
      echo "Sertifika yolları güvenli birer mutlak dosya yolu olmalı." >&2
      exit 1
    fi

    if [[ ! -f "$CLOUDFLARE_CERT_PATH" || ! -r "$CLOUDFLARE_CERT_PATH" ||
      ! -f "$CLOUDFLARE_KEY_PATH" || ! -r "$CLOUDFLARE_KEY_PATH" ]]; then
      echo "Cloudflare sertifika veya private key dosyası okunamıyor." >&2
      echo "Dosyaları VPS'ye yükleyip scripti yeniden çalıştırın." >&2
      exit 1
    fi
  elif [[ "$TLS_MODE" == "certbot" ]]; then
    prompt_required LETSENCRYPT_EMAIL "Let's Encrypt e-posta adresi"
    if ! validate_email "$LETSENCRYPT_EMAIL"; then
      echo "Let's Encrypt için geçerli bir e-posta adresi girin." >&2
      exit 1
    fi
  fi

  prompt_required ADMIN_EMAIL "CineDrive yönetici e-postası"
  prompt_required ADMIN_PASSWORD "CineDrive yönetici parolası" true
  if ! validate_email "$ADMIN_EMAIL"; then
    echo "Geçerli bir yönetici e-posta adresi girin." >&2
    exit 1
  fi

  if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
    echo "Yönetici parolası en az 8 karakter olmalı." >&2
    exit 1
  fi

  prompt_yes_no USE_GOOGLE_DRIVE "Google Drive kütüphanesi kullanacak mısınız?" no
  if [[ "$USE_GOOGLE_DRIVE" == "true" ]]; then
    prompt_required GOOGLE_CLIENT_ID "Google OAuth Client ID"
    prompt_required GOOGLE_CLIENT_SECRET "Google OAuth Client Secret" true
  else
    # The runtime schema requires non-empty values even though local libraries
    # never invoke OAuth. Make that implementation detail invisible to users.
    GOOGLE_CLIENT_ID="local-only.apps.googleusercontent.com"
    GOOGLE_CLIENT_SECRET="local-only-not-configured"
  fi
fi

echo "Sistem paketleri kuruluyor..."
apt-get update
packages=(
  ca-certificates \
  curl \
  ffmpeg \
  git \
  nginx \
  openssl \
  sudo \
  sqlite3
)
if [[ "${TLS_MODE:-}" == "certbot" ]]; then
  packages+=(certbot python3-certbot-nginx)
fi
DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"

if [[ "${TLS_MODE:-}" == "cloudflare" ]]; then
  if ! openssl x509 -in "$CLOUDFLARE_CERT_PATH" -noout >/dev/null 2>&1; then
    echo "Cloudflare sertifika dosyası geçerli bir X.509 PEM sertifikası değil." >&2
    exit 1
  fi
  if ! openssl pkey -in "$CLOUDFLARE_KEY_PATH" -noout -passin pass: >/dev/null 2>&1; then
    echo "Cloudflare private key dosyası geçerli veya parolasız bir PEM anahtarı değil." >&2
    exit 1
  fi
  if ! openssl x509 -in "$CLOUDFLARE_CERT_PATH" -noout -checkend 0 >/dev/null 2>&1; then
    echo "Cloudflare sertifikasının süresi dolmuş." >&2
    exit 1
  fi
  CERT_PUBLIC_KEY="$(openssl x509 -in "$CLOUDFLARE_CERT_PATH" -pubkey -noout)"
  KEY_PUBLIC_KEY="$(openssl pkey -in "$CLOUDFLARE_KEY_PATH" -pubout -passin pass:)"
  if [[ "$CERT_PUBLIC_KEY" != "$KEY_PUBLIC_KEY" ]]; then
    echo "Cloudflare sertifikası ile private key birbiriyle eşleşmiyor." >&2
    exit 1
  fi
fi

NODE_MAJOR=0
NODE_MINOR=0
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
  NODE_VERSION="${NODE_VERSION#v}"
  IFS=. read -r NODE_MAJOR NODE_MINOR _ <<<"$NODE_VERSION"
fi
if (( ! (NODE_MAJOR == 22 && NODE_MINOR >= 13) && NODE_MAJOR != 24 )); then
  echo "Node.js 22 kuruluyor..."
  NODE_SETUP_SCRIPT="$(mktemp)"
  curl --fail --silent --show-error --location \
    --proto '=https' --tlsv1.2 \
    --output "$NODE_SETUP_SCRIPT" \
    https://deb.nodesource.com/setup_22.x
  bash "$NODE_SETUP_SCRIPT"
  rm -f "$NODE_SETUP_SCRIPT"
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

if ! git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || [[ "$BRANCH" == -* ]]; then
  echo "BRANCH geçerli ve güvenli bir Git dal adı olmalı." >&2
  exit 1
fi

NODE_VERSION="$(node --version)"
NODE_VERSION="${NODE_VERSION#v}"
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<<"$NODE_VERSION"
if (( ! (NODE_MAJOR == 22 && NODE_MINOR >= 13) && NODE_MAJOR != 24 )); then
  echo "CineDrive Node.js 22.13+ veya Node.js 24 gerektiriyor; bulunan sürüm: ${NODE_VERSION}" >&2
  exit 1
fi

echo "pnpm ${PNPM_VERSION} kuruluyor..."
npm install --global "pnpm@${PNPM_VERSION}"

if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  groupadd --system "$APP_GROUP"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --create-home --home-dir "/home/${APP_USER}" \
    --shell /usr/sbin/nologin "$APP_USER"
fi

install -d -o "$APP_USER" -g "$APP_GROUP" -m 0755 "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$DATA_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$DATA_DIR/subtitle_cache"

if [[ -d "$APP_DIR/.git" ]]; then
  echo "Mevcut kaynak kodu güncelleniyor..."
  if [[ -n "$(sudo -u "$APP_USER" git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]]; then
    echo "İzlenen dosyalarda yerel değişiklik var; güncelleme bunları ezmemek için durduruldu." >&2
    exit 1
  fi

  CURRENT_BRANCH="$(sudo -u "$APP_USER" git -C "$APP_DIR" symbolic-ref --quiet --short HEAD || true)"
  if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
    echo "Kurulum '${CURRENT_BRANCH:-detached HEAD}' üzerinde; beklenen dal '${BRANCH}'." >&2
    echo "Dal değişimini açıkça yapıp scripti yeniden çalıştırın." >&2
    exit 1
  fi

  PREVIOUS_REV="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"
  load_database_config
  create_database_backup_if_present
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --prune origin "$BRANCH"
  TARGET_REV="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse "origin/$BRANCH")"
  if ! sudo -u "$APP_USER" git -C "$APP_DIR" merge-base --is-ancestor "$PREVIOUS_REV" "$TARGET_REV"; then
    echo "origin/${BRANCH}, kurulu commit'in fast-forward devamı değil; güncelleme durduruldu." >&2
    exit 1
  fi

  UPDATE_IN_PROGRESS="true"
  trap update_failure_report ERR
  sudo -u "$APP_USER" git -C "$APP_DIR" merge --ff-only "origin/$BRANCH"
else
  echo "Kaynak kodu indiriliyor..."
  find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q . && {
    echo "${APP_DIR} boş değil; güvenlik için kurulum durduruldu." >&2
    exit 1
  }
  sudo -u "$APP_USER" git clone --branch "$BRANCH" --single-branch -- "$REPO_URL" "$APP_DIR"
fi

if [[ "$INSTALL_MODE" == "fresh" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  if [[ "$TLS_MODE" == "http" ]]; then
    PUBLIC_SCHEME="http"
  else
    PUBLIC_SCHEME="https"
  fi

  echo "Uygulama ortam dosyası oluşturuluyor..."
  {
    printf 'NODE_ENV=production\n'
    printf 'PORT=3000\n'
    printf 'APP_NAME="CineDrive"\n'
    printf 'APP_URL=%s\n' "$(dotenv_escape "${PUBLIC_SCHEME}://${DOMAIN}")"
    printf 'API_URL=%s\n' "$(dotenv_escape "${PUBLIC_SCHEME}://${DOMAIN}/api")"
    printf 'PUBLIC_URL=%s\n' "$(dotenv_escape "${PUBLIC_SCHEME}://${DOMAIN}")"
    printf 'DATABASE_URL="file:%s/app.db"\n' "$DATA_DIR"
    printf 'SESSION_SECRET=%s\n' "$(dotenv_escape "$SESSION_SECRET")"
    printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$(dotenv_escape "$TOKEN_ENCRYPTION_KEY")"
    printf 'GOOGLE_CLIENT_ID=%s\n' "$(dotenv_escape "$GOOGLE_CLIENT_ID")"
    printf 'GOOGLE_CLIENT_SECRET=%s\n' "$(dotenv_escape "$GOOGLE_CLIENT_SECRET")"
    printf 'GOOGLE_REDIRECT_URI=%s\n' "$(dotenv_escape "${PUBLIC_SCHEME}://${DOMAIN}/api/auth/google/callback")"
    printf 'GOOGLE_DRIVE_ROOT_FOLDER_ID=""\n'
    printf 'ADMIN_EMAIL=%s\n' "$(dotenv_escape "$ADMIN_EMAIL")"
    printf 'ADMIN_PASSWORD=%s\n' "$(dotenv_escape "$ADMIN_PASSWORD")"
    printf 'CORS_ORIGIN=%s\n' "$(dotenv_escape "${PUBLIC_SCHEME}://${DOMAIN}")"
    printf 'TRUST_PROXY=true\n'
    printf 'APP_AUTH_MODE=single-user\n'
    printf 'METADATA_LANGUAGE=tr-TR\n'
    printf 'LOG_LEVEL=info\n'
    printf 'HLS_CACHE_MAX_BYTES=21474836480\n'
    printf 'HLS_MAX_ACTIVE_JOBS=2\n'
    printf 'TRANSCODE_MAX_ACTIVE_SESSIONS=2\n'
  } >"$APP_DIR/.env"
  chown "$APP_USER:$APP_GROUP" "$APP_DIR/.env"
  chmod 0600 "$APP_DIR/.env"
else
  echo "Mevcut ${APP_DIR}/.env dosyası korunuyor."
fi

if [[ "$INSTALL_MODE" == "fresh" ]]; then
  load_database_config
  create_database_backup_if_present
fi

echo "Bağımlılıklar, Prisma Client ve production build hazırlanıyor..."
sudo -u "$APP_USER" -H bash -c "
  set -Eeuo pipefail
  cd '$APP_DIR'
  pnpm install --frozen-lockfile
  pnpm prisma:generate
  NODE_OPTIONS='--max-old-space-size=3072' pnpm build
"

echo "Production migration'ları uygulanıyor..."
sudo -u "$APP_USER" -H env DATABASE_URL="$DATABASE_URL" \
  pnpm --dir "$APP_DIR" --filter @cinedrive/server prisma:deploy

install_backup_timer

if [[ "$INSTALL_MODE" == "update" ]]; then
  echo "CineDrive servisi yeniden başlatılıyor..."
  systemctl restart cinedrive
  if ! wait_for_api; then
    echo "CineDrive health check başarısız oldu." >&2
    systemctl status cinedrive --no-pager --full || true
    journalctl -u cinedrive -n 50 --no-pager || true
    update_failure_report 1
  fi

  UPDATE_IN_PROGRESS="false"
  trap - ERR
  echo
  echo "CineDrive güncellemesi tamamlandı."
  if [[ -n "$DATABASE_BACKUP" ]]; then
    echo "Veritabanı yedek dizini: ${DATABASE_BACKUP}"
  fi
  exit 0
fi

cat >"$SYSTEMD_UNIT" <<EOF
[Unit]
Description=CineDrive API Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/apps/server/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
UMask=0027

[Install]
WantedBy=multi-user.target
EOF

if [[ "$TLS_MODE" == "cloudflare" ]]; then
  cat >/etc/nginx/sites-available/cinedrive <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
EOF
  NGINX_LISTEN=$'    listen 443 ssl;\n    listen [::]:443 ssl;'
  NGINX_TLS_CONFIG="    ssl_certificate ${CLOUDFLARE_CERT_PATH};
    ssl_certificate_key ${CLOUDFLARE_KEY_PATH};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
"
else
  : >/etc/nginx/sites-available/cinedrive
  NGINX_LISTEN=$'    listen 80;\n    listen [::]:80;'
  NGINX_TLS_CONFIG=""
fi

cat >>/etc/nginx/sites-available/cinedrive <<EOF
server {
${NGINX_LISTEN}
    server_name ${DOMAIN};

${NGINX_TLS_CONFIG}
    root ${APP_DIR}/apps/web/dist;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location = /health {
        access_log off;
        add_header Content-Type text/plain;
        return 200 'healthy';
    }

    # Range isteklerini ve 206 yanıtlarını bozmadan video akışı.
    location ~ ^/api/media/.+/stream\$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-ID \$request_id;
        proxy_set_header Range \$http_range;
        proxy_set_header If-Range \$http_if_range;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
        add_header X-Accel-Buffering "no" always;
    }

    # HLS ve önizleme hazırlanırken uzun transcode kuyruğuna izin ver.
    location ~ ^/api/media/.+/(hls|preview)(/|\$) {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-ID \$request_id;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
        add_header X-Accel-Buffering "no" always;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-ID \$request_id;
        client_max_body_size 10M;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    location ~* \.(?:css|js|jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc|woff|woff2)\$ {
        expires 1y;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sfn /etc/nginx/sites-available/cinedrive /etc/nginx/sites-enabled/cinedrive

systemctl daemon-reload
systemctl enable --now cinedrive
nginx -t
rm -f /etc/nginx/sites-enabled/default
systemctl reload nginx

if [[ "$TLS_MODE" == "certbot" ]]; then
  echo "Let's Encrypt TLS sertifikası alınıyor..."
  certbot --nginx \
    --domain "$DOMAIN" \
    --email "$LETSENCRYPT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --redirect \
    --non-interactive
elif [[ "$TLS_MODE" == "cloudflare" ]]; then
  echo "Cloudflare Origin Certificate etkinleştirildi."
else
  echo "TLS kurulmadı; site yalnızca HTTP üzerinden yayınlanıyor."
fi

nginx -t
systemctl reload nginx

if ! wait_for_api; then
  echo "CineDrive health check başarısız oldu." >&2
  systemctl status cinedrive --no-pager --full || true
  journalctl -u cinedrive -n 50 --no-pager || true
  exit 1
fi

echo
echo "CineDrive kurulumu tamamlandı: ${PUBLIC_SCHEME}://${DOMAIN}"
if [[ -n "$DATABASE_BACKUP" ]]; then
  echo "Veritabanı yedeği: ${DATABASE_BACKUP}"
fi
echo "Servis durumu: systemctl status cinedrive"
echo "Servis logları: journalctl -u cinedrive -f"
if [[ "$USE_GOOGLE_DRIVE" == "true" ]]; then
  echo "Google OAuth Authorized redirect URI:"
  echo "${PUBLIC_SCHEME}://${DOMAIN}/api/auth/google/callback"
else
  echo "Google Drive devre dışı bırakıldı; daha sonra .env içindeki OAuth değerlerini güncelleyebilirsiniz."
fi
