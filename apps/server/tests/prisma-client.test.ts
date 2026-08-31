import { describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/lib/prisma-client.js';

describe('Prisma 7 SQLite compatibility', () => {
  it('keeps native-driver DateTime values in Unix-millisecond format', async () => {
    const prisma = createPrismaClient(':memory:');

    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "User" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "email" TEXT NOT NULL UNIQUE,
          "passwordHash" TEXT,
          "name" TEXT NOT NULL,
          "role" TEXT NOT NULL DEFAULT 'user',
          "opensubtitlesApiKey" TEXT,
          "opensubtitlesUsername" TEXT,
          "tmdbApiKey" TEXT,
          "acoustidApiKey" TEXT,
          "preferredLanguages" TEXT NOT NULL DEFAULT 'tr,en',
          "createdAt" DATETIME NOT NULL,
          "updatedAt" DATETIME NOT NULL,
          "disabledAt" DATETIME
        )
      `);

      const timestamp = new Date('2026-08-31T00:00:00.000Z');
      await prisma.user.create({
        data: {
          id: 'adapter-date-write',
          email: 'adapter-write@example.test',
          name: 'Adapter Write',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      const [stored] = await prisma.$queryRawUnsafe<Array<{ storageType: string }>>(
        `SELECT typeof("createdAt") AS "storageType" FROM "User" WHERE "id" = ?`,
        'adapter-date-write',
      );
      expect(stored?.storageType).toBe('integer');

      await prisma.$executeRawUnsafe(
        `INSERT INTO "User" ("id", "email", "name", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?)`,
        'adapter-date-read',
        'adapter-read@example.test',
        'Adapter Read',
        timestamp.getTime(),
        timestamp.getTime(),
      );

      const legacyUser = await prisma.user.findUniqueOrThrow({
        where: { id: 'adapter-date-read' },
      });
      expect(legacyUser.createdAt).toEqual(timestamp);
      expect(legacyUser.updatedAt).toEqual(timestamp);
    } finally {
      await prisma.$disconnect();
    }
  });
});
