ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;

CREATE TABLE "LibraryMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'listener',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LibraryMembership_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibraryMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LibraryMembership_libraryId_userId_key" ON "LibraryMembership"("libraryId", "userId");
CREATE INDEX "LibraryMembership_userId_idx" ON "LibraryMembership"("userId");

INSERT INTO "LibraryMembership" ("id", "libraryId", "userId", "role", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       "id", "userId", 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Library";

ALTER TABLE "MusicPlaybackState" ADD COLUMN "clientId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "MusicPlaybackState" ADD COLUMN "clientName" TEXT;
ALTER TABLE "MusicPlaybackState" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'unknown';
DROP INDEX "MusicPlaybackState_userId_key";
CREATE UNIQUE INDEX "MusicPlaybackState_userId_clientId_key" ON "MusicPlaybackState"("userId", "clientId");
CREATE INDEX "MusicPlaybackState_userId_updatedAt_idx" ON "MusicPlaybackState"("userId", "updatedAt");
