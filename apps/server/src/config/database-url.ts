const SQLITE_CONNECTION_LIMIT = '1';
const SQLITE_SOCKET_TIMEOUT_SECONDS = '15';

/**
 * SQLite only permits one writer at a time. Prisma otherwise sizes its pool
 * from the host CPU count, which lets background scans and API requests race
 * for SQLite's write lock. Keep one connection for the embedded database and
 * give external lock holders (for example a backup) a bounded grace period.
 */
export const configureDatabaseUrl = (databaseUrl: string): string => {
  if (!databaseUrl.startsWith('file:')) return databaseUrl;

  const queryIndex = databaseUrl.indexOf('?');
  const pathname = queryIndex === -1 ? databaseUrl : databaseUrl.slice(0, queryIndex);
  const search = new URLSearchParams(queryIndex === -1 ? '' : databaseUrl.slice(queryIndex + 1));

  if (!search.has('connection_limit')) {
    search.set('connection_limit', SQLITE_CONNECTION_LIMIT);
  }
  if (!search.has('socket_timeout')) {
    search.set('socket_timeout', SQLITE_SOCKET_TIMEOUT_SECONDS);
  }

  return `${pathname}?${search.toString()}`;
};
