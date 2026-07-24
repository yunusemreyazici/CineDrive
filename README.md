# CineDrive - Personal Google Drive Media Player

Production-grade monorepo media streaming server and client for personal Google Drive archives.

## 📁 Workspace Structure

```text
CineDrive/
├── apps/
│   ├── server/       # Fastify + TypeScript + Prisma SQLite Backend
│   └── web/          # React + Vite + TypeScript + Tailwind CSS Frontend
├── packages/
│   └── shared/       # Shared TypeScript types, Zod schemas, constants
├── nginx/            # Reverse proxy configuration with Range streaming support
├── Dockerfile.server # Multi-stage backend Docker image
├── Dockerfile.web    # Multi-stage frontend + Nginx Docker image
├── docker-compose.yml# Production Docker Compose orchestration
└── pnpm-workspace.yaml
```

---

## 🛠️ Quick Start (Local Development)

1. **Install Dependencies:**
   ```bash
   pnpm install
   ```

2. **Setup Environment:**
   Copy `.env.example` to `.env` and fill in required OAuth & secret variables.

3. **Database Migration & Client Generation:**
   ```bash
   pnpm --filter "@cinedrive/server" exec prisma db push
   ```

4. **Run Tests, Typecheck & Lint:**
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

5. **Start Development Server:**
   ```bash
   pnpm dev
   ```

---

## 🚀 Production Deployment (Docker Compose & Nginx)

### 1. Generate Secure Keys
Generate strong 32-byte hexadecimal secrets for session and encryption:
```bash
openssl rand -hex 32
```

### 2. Configure Environment
Create `.env` file on your production server:
```bash
cp .env.example .env
nano .env
```

### 3. Build & Launch Docker Containers
```bash
docker compose build
docker compose up -d
```

### 4. Monitor Logs & Container Health
```bash
docker compose ps
docker compose logs -f server
docker compose logs -f nginx
```

---

## 🔐 HTTPS & Certbot SSL Configuration

In production, terminate SSL using Certbot on the host system or Caddy:

```bash
sudo apt update && sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

Nginx configuration automatically proxies `/api/media/.+/stream` Range requests with `proxy_buffering off;` and `add_header X-Accel-Buffering no always;` for zero-lag video streaming.

---

## 💾 SQLite Backup & Restore Strategy (WAL Mode Safe)

SQLite database file is stored safely inside named volume `cinedrive_app_data` (`/app/data/app.db`).

### Backup Database
To create a safe online backup without corrupting active WAL transactions:
```bash
docker compose exec server npx prisma db execute --stdin <<EOF
PRISMA_BACKUP;
EOF
docker compose exec server sh -c "cp /app/data/app.db /app/data/app.db.bak"
```

### Restore Database
```bash
docker compose stop server
docker compose run --rm server sh -c "cp /app/data/app.db.bak /app/data/app.db"
docker compose start server
```

---

## 🔄 Safe Update Workflow

1. Backup SQLite database:
   ```bash
   docker compose exec server sh -c "cp /app/data/app.db /app/data/app.db.bak"
   ```
2. Pull latest code & rebuild containers:
   ```bash
   git pull origin main
   docker compose build
   docker compose up -d
   ```
3. Verify container health:
   ```bash
   docker compose ps
   curl -I http://localhost/api/health
   ```

---

## 📋 Production Readiness Checklist

- [ ] Domain DNS pointing to VPS IP
- [ ] HTTPS Certificate installed & verified
- [ ] Google OAuth Redirect URI configured (`https://yourdomain.com/api/auth/google/callback`)
- [ ] Google Drive Root Folder ID configured
- [ ] Cryptographically strong `SESSION_SECRET` generated (64-char hex)
- [ ] Strong `TOKEN_ENCRYPTION_KEY` generated (64-char hex)
- [ ] Admin password updated from default
- [ ] `.env` verified NOT committed to Git repository
- [ ] SQLite persistent Docker volume verified
- [ ] Range HTTP 206 streaming verified (`curl -I https://yourdomain.com/api/media/FILE_ID/stream`)
- [ ] Nginx proxy buffering disabled for video stream
- [ ] Security headers enabled in Nginx (`X-Content-Type-Options`, `X-Frame-Options`)
- [ ] Per-route rate limiting active
- [ ] Pino logger sensitive credential redaction active
- [ ] Server and Nginx containers reported `healthy`
