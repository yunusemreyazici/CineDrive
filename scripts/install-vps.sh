#!/usr/bin/env bash
set -Eeuo pipefail

# CineDrive bare-metal installer and safe updater for Ubuntu/Debian VPS hosts.
# Run as root: bash scripts/install-vps.sh

APP_USER="cinedrive"
APP_GROUP="cinedrive"
APP_DIR="/opt/cinedrive"
DATA_DIR="/var/lib/cinedrive"
REPO_URL="${REPO_URL:-https://github.com/yunusemreyazici/CineDrive.git}"
BRANCH="${BRANCH:-main}"
PNPM_VERSION="${PNPM_VERSION:-11.22.0}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bu script root olarak çalıştırılmalı." >&2
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

wait_for_api() {
  systemctl is-active --quiet cinedrive || return 1
  curl --fail --show-error --silent \
    --retry 10 \
    --retry-connrefused \
    --retry-delay 1 \
    http://127.0.0.1:3000/api/health >/dev/null
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
if [[ -d "$APP_DIR/.git" && -f "$APP_DIR/.env" ]]; then
  INSTALL_MODE="update"
  echo "Mevcut CineDrive kurulumu bulundu; yapılandırma ve gizli anahtarlar korunacak."
elif [[ -e "$APP_DIR/.git" || -e "$APP_DIR/.env" ]]; then
  echo "${APP_DIR} altında eksik bir kurulum bulundu (.git ve .env birlikte olmalı)." >&2
  echo "Veri kaybını önlemek için kurulum durduruldu." >&2
  exit 1
fi

if [[ "$INSTALL_MODE" == "fresh" ]]; then
  prompt_required DOMAIN "Alan adı (ör. film.example.com)"
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"

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

    if [[ ! -r "$CLOUDFLARE_CERT_PATH" || ! -r "$CLOUDFLARE_KEY_PATH" ]]; then
      echo "Cloudflare sertifika veya private key dosyası okunamıyor." >&2
      echo "Dosyaları VPS'ye yükleyip scripti yeniden çalıştırın." >&2
      exit 1
    fi
  elif [[ "$TLS_MODE" == "certbot" ]]; then
    prompt_required LETSENCRYPT_EMAIL "Let's Encrypt e-posta adresi"
  fi

  prompt_required ADMIN_EMAIL "CineDrive yönetici e-postası"
  prompt_required ADMIN_PASSWORD "CineDrive yönetici parolası" true
  prompt_required GOOGLE_CLIENT_ID "Google OAuth Client ID"
  prompt_required GOOGLE_CLIENT_SECRET "Google OAuth Client Secret" true

  if [[ "$DOMAIN" == "localhost" || "$DOMAIN" != *.* ]]; then
    echo "Geçerli, DNS kaydı bu VPS'ye yönlendirilmiş bir alan adı girin." >&2
    exit 1
  fi

  if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
    echo "Yönetici parolası en az 8 karakter olmalı." >&2
    exit 1
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
  sqlite3
)
if [[ "${TLS_MODE:-}" == "certbot" ]]; then
  packages+=(certbot python3-certbot-nginx)
fi
DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"

NODE_MAJOR=0
NODE_MINOR=0
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
  NODE_VERSION="${NODE_VERSION#v}"
  IFS=. read -r NODE_MAJOR NODE_MINOR _ <<<"$NODE_VERSION"
fi
if (( ! (NODE_MAJOR == 22 && NODE_MINOR >= 13) && NODE_MAJOR != 24 )); then
  echo "Node.js 22 kuruluyor..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
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
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --prune origin
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  echo "Kaynak kodu indiriliyor..."
  find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q . && {
    echo "${APP_DIR} boş değil; güvenlik için kurulum durduruldu." >&2
    exit 1
  }
  sudo -u "$APP_USER" git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
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

echo "Bağımlılıklar, Prisma Client ve production build hazırlanıyor..."
sudo -u "$APP_USER" -H bash -c "
  set -Eeuo pipefail
  cd '$APP_DIR'
  pnpm install --frozen-lockfile
  pnpm prisma:generate
  NODE_OPTIONS='--max-old-space-size=3072' pnpm build
"

DATABASE_URL="$(read_database_url)"
DATABASE_PATH="${DATABASE_URL#file:}"
if [[ "$DATABASE_PATH" == *"'"* ]]; then
  echo "SQLite dosya yolu tek tırnak içeremez." >&2
  exit 1
fi

DATABASE_BACKUP=""
if [[ -f "$DATABASE_PATH" ]]; then
  BACKUP_DIR="${DATA_DIR}/backups"
  install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$BACKUP_DIR"
  echo "Migration öncesi doğrulamalı SQLite yedeği alınıyor..."
  sudo -u "$APP_USER" -H env DATABASE_URL="$DATABASE_URL" \
    node "$APP_DIR/apps/server/dist/cli/database-backup.js" \
      --output-dir "$BACKUP_DIR" --retain 14
  DATABASE_BACKUP="$BACKUP_DIR"
fi

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
    exit 1
  fi

  echo
  echo "CineDrive güncellemesi tamamlandı."
  if [[ -n "$DATABASE_BACKUP" ]]; then
    echo "Veritabanı yedek dizini: ${DATABASE_BACKUP}"
  fi
  exit 0
fi

cat >/etc/systemd/system/cinedrive.service <<EOF
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
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now cinedrive
nginx -t
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
echo "Google OAuth Authorized redirect URI:"
echo "${PUBLIC_SCHEME}://${DOMAIN}/api/auth/google/callback"
