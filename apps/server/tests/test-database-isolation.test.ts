import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDatabase, resolveTestDatabasePath } from './test-database.js';

describe('invocation-scoped test database', () => {
  it('allocates separate paths and cannot clean up a development database', () => {
    const first = createTestDatabase(),
      second = createTestDatabase();
    try {
      expect(first.databasePath).not.toBe(second.databasePath);
      expect(resolveTestDatabasePath(first.databaseUrl)).toBe(first.databasePath);
      expect(resolveTestDatabasePath(second.databaseUrl)).toBe(second.databasePath);
      expect(() => resolveTestDatabasePath('file:./data/dev.db')).toThrow();
      expect(() => resolveTestDatabasePath('file:/tmp/cinedrive-vitest.db')).toThrow();
      fs.writeFileSync(first.databasePath, 'first');
      fs.writeFileSync(second.databasePath, 'second');
      fs.unlinkSync(first.databasePath);
      expect(fs.readFileSync(second.databasePath, 'utf8')).toBe('second');
    } finally {
      for (const fixture of [first, second]) {
        fs.rmSync(fixture.databasePath, { force: true });
        fs.rmdirSync(path.dirname(fixture.databasePath));
      }
    }
  });
});
