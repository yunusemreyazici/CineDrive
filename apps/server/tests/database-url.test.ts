import { describe, expect, it } from 'vitest';
import { toSqliteAdapterInput } from '../src/config/database-url';

describe('toSqliteAdapterInput', () => {
  it('strips the file: scheme for the better-sqlite3 adapter', () => {
    expect(toSqliteAdapterInput('file:./data/app.db')).toEqual({ url: './data/app.db' });
  });

  it('drops engine-era query parameters', () => {
    expect(
      toSqliteAdapterInput('file:/app/data/app.db?connection_limit=2&socket_timeout=30'),
    ).toEqual({ url: '/app/data/app.db' });
  });

  it('keeps the in-memory marker untouched', () => {
    expect(toSqliteAdapterInput(':memory:')).toEqual({ url: ':memory:' });
  });

  it('passes through non-SQLite URLs unchanged', () => {
    const url = 'postgresql://user:secret@example.com/cinedrive';
    expect(toSqliteAdapterInput(url)).toEqual({ url });
  });
});
