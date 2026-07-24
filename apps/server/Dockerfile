FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cinedrive/shared build
RUN pnpm --filter @cinedrive/server prisma:generate
RUN pnpm --filter @cinedrive/server build

FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/server ./apps/server

EXPOSE 3000

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@cinedrive/server", "start"]
