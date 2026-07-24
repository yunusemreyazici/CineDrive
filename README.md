# CineDrive - Personal Google Drive Media Player

Production-grade monorepo media streaming server and client for personal Google Drive archives.

## Workspace Structure

```
CineDrive/
├── apps/
│   ├── server/       # Fastify + TypeScript + Prisma SQLite Backend
│   └── web/          # React + Vite + TypeScript + Tailwind CSS Frontend
├── packages/
│   └── shared/       # Shared TypeScript types, Zod schemas, constants
├── nginx/            # Reverse proxy configuration with Range streaming support
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Quick Start (Development)

1. **Install Dependencies:**
   ```bash
   pnpm install
   ```

2. **Setup Environment:**
   Copy `.env.example` to `.env` and fill in required secrets.

3. **Generate Prisma Client:**
   ```bash
   pnpm prisma:generate
   ```

4. **Run Typecheck & Lint:**
   ```bash
   pnpm typecheck
   pnpm lint
   ```

5. **Build All Packages:**
   ```bash
   pnpm build
   ```

6. **Start Dev Mode:**
   ```bash
   pnpm dev
   ```
