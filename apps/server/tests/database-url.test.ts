import { describe, expect, it } from 'vitest';
import { configureDatabaseUrl } from '../src/config/database-url';

describe('configureDatabaseUrl', () => {
  it('serializes Prisma access to an SQLite database', () => {
    expect(configureDatabaseUrl('file:./data/app.db')).toBe(
      'file:./data/app.db?connection_limit=1&socket_timeout=15',
    );
  });

  it('preserves explicit SQLite tuning', () => {
    expect(configureDatabaseUrl('file:/app/data/app.db?connection_limit=2&socket_timeout=30')).toBe(
      'file:/app/data/app.db?connection_limit=2&socket_timeout=30',
    );
  });

  it('leaves server database URLs unchanged', () => {
    const url = 'postgresql://user:secret@example.com/cinedrive';
    expect(configureDatabaseUrl(url)).toBe(url);
  });
});
