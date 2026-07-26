-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MediaItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "normalizedTitle" TEXT NOT NULL,
    "year" INTEGER,
    "overview" TEXT,
    "posterDriveFileId" TEXT,
    "backdropDriveFileId" TEXT,
    "posterUrl" TEXT,
    "backdropUrl" TEXT,
    "duration" REAL,
    "voteAverage" REAL,
    "voteCount" INTEGER,
    "genres" TEXT,
    "cast" TEXT,
    "trailerUrl" TEXT,
    "contentRating" TEXT,
    "tmdbId" INTEGER,
    "imdbId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaItem_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MediaItem" ("backdropDriveFileId", "backdropUrl", "cast", "contentRating", "createdAt", "duration", "genres", "id", "imdbId", "normalizedTitle", "originalTitle", "overview", "posterDriveFileId", "posterUrl", "title", "tmdbId", "trailerUrl", "type", "updatedAt", "voteAverage", "voteCount", "year") SELECT "backdropDriveFileId", "backdropUrl", "cast", "contentRating", "createdAt", "duration", "genres", "id", "imdbId", "normalizedTitle", "originalTitle", "overview", "posterDriveFileId", "posterUrl", "title", "tmdbId", "trailerUrl", "type", "updatedAt", "voteAverage", "voteCount", "year" FROM "MediaItem";
DROP TABLE "MediaItem";
ALTER TABLE "new_MediaItem" RENAME TO "MediaItem";
CREATE INDEX "MediaItem_normalizedTitle_idx" ON "MediaItem"("normalizedTitle");
CREATE INDEX "MediaItem_type_idx" ON "MediaItem"("type");
CREATE INDEX "MediaItem_libraryId_idx" ON "MediaItem"("libraryId");
-- Backfill from the chain the column replaces: a movie's file, or failing
-- that any episode's file, tells us which library the record came from.
UPDATE "MediaItem"
SET "libraryId" = COALESCE(
  (
    SELECT df."libraryId"
      FROM "Movie" m
      JOIN "DriveFile" df ON df."id" = m."driveFileId"
     WHERE m."mediaItemId" = "MediaItem"."id"
  ),
  (
    SELECT df."libraryId"
      FROM "Episode" e
      JOIN "DriveFile" df ON df."id" = e."driveFileId"
     WHERE e."mediaItemId" = "MediaItem"."id"
     LIMIT 1
  )
);

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
