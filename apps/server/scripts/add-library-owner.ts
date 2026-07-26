import { PrismaClient } from '@prisma/client';
// Imported for its side effect: loads the repository .env, so the script talks
// to exactly the database the server uses rather than a guessed path.
import '../src/config/env.js';

/**
 * Adds `Library.userId` to a database created before libraries had an owner.
 *
 * `prisma db push` — how this project provisions its schema — cannot make this
 * change on its own: `userId` is NOT NULL with no default, so it would offer to
 * drop the table and take every library with it. This script rebuilds the table
 * and backfills the owner instead, then `db push` sees a schema that already
 * matches.
 *
 * Existing rows are assigned to the user behind their Google connection, and to
 * the oldest account when there is none — a local library had no owner to read
 * off, and the oldest account is the admin the server bootstraps.
 *
 * Idempotent: running it against an already-migrated database does nothing.
 * Dry run by default. Pass `--apply` to actually write.
 */

const prisma = new PrismaClient();

const hasOwnerColumn = async () => {
  const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(
    'PRAGMA table_info("Library")',
  );
  return columns.some((column) => column.name === 'userId');
};

const run = async () => {
  const apply = process.argv.includes('--apply');

  if (await hasOwnerColumn()) {
    console.log('Library.userId zaten var, yapılacak bir şey yok.');
    return;
  }

  const [libraryCount, userCount] = await Promise.all([
    prisma.$queryRawUnsafe<{ count: number }[]>('SELECT COUNT(*) AS count FROM "Library"'),
    prisma.user.count(),
  ]);
  const libraries = Number(libraryCount[0]?.count ?? 0);

  console.log(`${libraries} kütüphane, ${userCount} kullanıcı bulundu.`);

  if (libraries > 0 && userCount === 0) {
    console.error(
      'İPTAL: kütüphaneler var ama hiç kullanıcı yok, sahiplik atanamaz. ' +
        'Önce sunucuyu bir kez çalıştırıp admin hesabının oluşmasını sağlayın.',
    );
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('Kuru çalışma. Uygulamak için: --apply');
    return;
  }

  // SQLite cannot add a NOT NULL column with a foreign key in place, so the
  // table is rebuilt — the same shape Prisma itself generates for this change.
  const statements = [
    'PRAGMA foreign_keys=OFF',
    `CREATE TABLE "new_Library" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "storageType" TEXT NOT NULL DEFAULT 'gdrive',
        "rootFolderId" TEXT NOT NULL DEFAULT '',
        "localFolderPath" TEXT,
        "googleConnectionId" TEXT,
        "driveId" TEXT,
        "lastScannedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "Library_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "Library_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
    `INSERT INTO "new_Library" ("id", "name", "userId", "storageType", "rootFolderId", "localFolderPath", "googleConnectionId", "driveId", "lastScannedAt", "createdAt", "updatedAt")
       SELECT "id", "name",
         COALESCE(
           (SELECT "userId" FROM "GoogleConnection" WHERE "GoogleConnection"."id" = "Library"."googleConnectionId"),
           (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
         ),
         "storageType", "rootFolderId", "localFolderPath", "googleConnectionId", "driveId", "lastScannedAt", "createdAt", "updatedAt"
       FROM "Library"`,
    'DROP TABLE "Library"',
    'ALTER TABLE "new_Library" RENAME TO "Library"',
    'CREATE INDEX "Library_userId_idx" ON "Library"("userId")',
    'PRAGMA foreign_keys=ON',
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const owners = await prisma.$queryRawUnsafe<{ email: string; count: number }[]>(
    `SELECT "User"."email" AS email, COUNT(*) AS count
       FROM "Library" JOIN "User" ON "User"."id" = "Library"."userId"
      GROUP BY "User"."email"`,
  );
  console.log('Sahiplik atandı:');
  for (const owner of owners) console.log(`  ${owner.count} × ${owner.email}`);
};

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
