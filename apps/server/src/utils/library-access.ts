import type { Prisma } from '@prisma/client';

/**
 * The single definition of "libraries this user may read".
 *
 * Ownership used to be derived through `Library.googleConnection`, which meant
 * a library with no connection — every local-folder library — had no owner in
 * the schema and was visible to any authenticated caller. `Library.userId` now
 * records the owner directly, so the rule is a plain equality check.
 *
 * This lives in one place because the filter previously existed as four
 * copy-pasted object literals across the media and insights routes.
 */
export const ownedLibraryFilter = (userId: string): Prisma.LibraryWhereInput => ({ userId });

/** Same rule, expressed for queries that filter `DriveFile` by its library. */
export const ownedDriveFileFilter = (userId: string): Prisma.DriveFileWhereInput => ({
  library: ownedLibraryFilter(userId),
});
