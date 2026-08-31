import type { Prisma } from '@cinedrive/prisma';

/**
 * The single definition of libraries this user may read. Owners are implicit;
 * shared access is represented by LibraryMembership.
 *
 * Ownership used to be derived through `Library.googleConnection`, which meant
 * a library with no connection — every local-folder library — had no owner in
 * the schema and was visible to any authenticated caller. `Library.userId` now
 * records the owner directly, so the rule is a plain equality check.
 *
 * This lives in one place because the filter previously existed as four
 * copy-pasted object literals across the media and insights routes.
 */
export const accessibleLibraryFilter = (userId: string): Prisma.LibraryWhereInput => ({
  OR: [{ userId }, { memberships: { some: { userId } } }],
});

/** Libraries whose catalogue/settings the user may change. */
export const manageableLibraryFilter = (userId: string): Prisma.LibraryWhereInput => ({
  OR: [
    { userId },
    { memberships: { some: { userId, role: { in: ['owner', 'editor'] } } } },
  ],
});

/** Backwards-compatible name used by read paths throughout the server. */
export const ownedLibraryFilter = accessibleLibraryFilter;

/** Same rule, expressed for queries that filter `DriveFile` by its library. */
export const ownedDriveFileFilter = (userId: string): Prisma.DriveFileWhereInput => ({
  library: ownedLibraryFilter(userId),
});

/**
 * Media the user may read.
 *
 * `MediaItem.libraryId` makes this a single hop. Reaching the owner used to
 * mean walking movie or episode → driveFile → library → user, so every caller
 * wrote a two-branch `OR` over both relations.
 */
export const ownedMediaFilter = (userId: string): Prisma.MediaItemWhereInput => ({
  library: ownedLibraryFilter(userId),
});

export const manageableMediaFilter = (userId: string): Prisma.MediaItemWhereInput => ({
  library: manageableLibraryFilter(userId),
});
