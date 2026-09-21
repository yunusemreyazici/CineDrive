import type { PrismaClient } from '@cinedrive/prisma';

/**
 * Keep this value alongside the newest checked-in migration. A production
 * process must never advertise readiness while the binary expects a schema
 * newer than the one Prisma has applied.
 */
export const EXPECTED_LATEST_MIGRATION = '20260921020000_playback_tracking_keys';

type MigrationRow = {
  migration_name: string;
  finished_at: string | null;
  rolled_back_at: string | null;
};

export const hasProductionSchema = async (prisma: PrismaClient): Promise<boolean> => {
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT "migration_name", "finished_at", "rolled_back_at"
    FROM "_prisma_migrations"
    WHERE "migration_name" = ${EXPECTED_LATEST_MIGRATION}
       OR ("finished_at" IS NULL AND "rolled_back_at" IS NULL)
  `;

  const latest = rows.find((row) => row.migration_name === EXPECTED_LATEST_MIGRATION);
  if (!latest?.finished_at || latest.rolled_back_at) return false;

  return !rows.some((row) => row.finished_at === null && row.rolled_back_at === null);
};

export const assertProductionSchema = async (prisma: PrismaClient): Promise<void> => {
  if (!(await hasProductionSchema(prisma))) {
    throw new Error('DATABASE_MIGRATION_PENDING');
  }
};
