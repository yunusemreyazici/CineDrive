import type { Prisma } from '@prisma/client';

/**
 * The single definition of "libraries this user may read".
 *
 * Ownership is derived indirectly: `Library` has no `userId` of its own, only
 * an optional `googleConnection`, and that connection carries the user. A
 * library with no connection — every local-folder library — therefore has no
 * owner in the schema at all, so it is visible to any authenticated caller.
 *
 * That is acceptable while the deployment has a single admin account, which is
 * what `AuthService.ensureAdminUserExists` creates. Supporting real multi-user
 * access needs `Library.userId` on the model; once it exists, this is the only
 * place the filter has to change. It previously lived as four copy-pasted
 * object literals across the media and insights routes.
 */
export const ownedLibraryFilter = (userId: string): Prisma.LibraryWhereInput => ({
  OR: [{ googleConnection: { userId } }, { googleConnectionId: null }],
});

/** Same rule, expressed for queries that filter `DriveFile` by its library. */
export const ownedDriveFileFilter = (userId: string): Prisma.DriveFileWhereInput => ({
  library: ownedLibraryFilter(userId),
});
