import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@cinedrive/prisma';
import {
  EXPECTED_LATEST_MIGRATION,
  hasProductionSchema,
} from '../src/services/database-readiness.service.js';

const makePrisma = (rows: unknown[]) =>
  ({ $queryRaw: vi.fn().mockResolvedValue(rows) }) as unknown as PrismaClient;

describe('database production readiness', () => {
  it('accepts a fully applied migration chain with no unfinished rows', async () => {
    const prisma = makePrisma([
      {
        migration_name: EXPECTED_LATEST_MIGRATION,
        finished_at: '2026-09-21T00:00:00Z',
        rolled_back_at: null,
      },
    ]);

    await expect(hasProductionSchema(prisma)).resolves.toBe(true);
  });

  it('rejects the process when the expected migration is missing or unfinished', async () => {
    const prisma = makePrisma([
      {
        migration_name: '20260914010000_music_connect_remote_controller',
        finished_at: '2026-09-14T00:00:00Z',
        rolled_back_at: null,
      },
      { migration_name: EXPECTED_LATEST_MIGRATION, finished_at: null, rolled_back_at: null },
    ]);

    await expect(hasProductionSchema(prisma)).resolves.toBe(false);
  });

  it('rejects any unfinished migration even when the latest one is present', async () => {
    const prisma = makePrisma([
      {
        migration_name: EXPECTED_LATEST_MIGRATION,
        finished_at: '2026-09-21T00:00:00Z',
        rolled_back_at: null,
      },
      { migration_name: 'future_partial_migration', finished_at: null, rolled_back_at: null },
    ]);

    await expect(hasProductionSchema(prisma)).resolves.toBe(false);
  });
});
