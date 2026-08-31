import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { toSqliteAdapterInput } from '../config/database-url.js';

type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

export const createPrismaClient = (databaseUrl: string, log?: PrismaLogLevel[]): PrismaClient => {
  const adapter = new PrismaBetterSqlite3(toSqliteAdapterInput(databaseUrl), {
    // Prisma's native SQLite driver stored DateTime values as Unix epoch
    // milliseconds. Keep that format so existing CineDrive databases remain
    // readable after switching to the Prisma 7 driver adapter.
    timestampFormat: 'unixepoch-ms',
  });

  return new PrismaClient({
    adapter,
    ...(log ? { log } : {}),
  });
};
