/**
 * Prisma 7 connects through the better-sqlite3 driver adapter instead of the
 * old Rust query engine. The engine-era `connection_limit`/`socket_timeout`
 * query parameters no longer apply: better-sqlite3 is synchronous and the
 * adapter opens a single connection per client, so there is nothing to tune.
 *
 * The adapter accepts `{ url }` where `url` is a SQLite file path (or the
 * special `:memory:` marker), so strip the `file:` scheme and legacy engine
 * query parameters from DATABASE_URL.
 */
export const toSqliteAdapterInput = (databaseUrl: string): { url: string } => {
  if (databaseUrl === ':memory:') return { url: databaseUrl };
  if (!databaseUrl.startsWith('file:')) return { url: databaseUrl };

  const withoutScheme = databaseUrl.replace(/^file:/, '');
  const queryIndex = withoutScheme.indexOf('?');
  const pathname = queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex);

  return { url: pathname };
};
