CREATE TABLE "MetadataEnrichmentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER,
    "refreshMedia" BOOLEAN NOT NULL DEFAULT false,
    "refreshEpisodes" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MetadataEnrichmentJob_libraryId_fkey"
      FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MetadataEnrichmentJob_mediaItemId_fkey"
      FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MetadataEnrichmentJob_seriesId_fkey"
      FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MetadataEnrichmentJob_libraryId_mediaItemId_key"
ON "MetadataEnrichmentJob"("libraryId", "mediaItemId");

CREATE INDEX "MetadataEnrichmentJob_status_nextAttemptAt_createdAt_idx"
ON "MetadataEnrichmentJob"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "MetadataEnrichmentJob_status_updatedAt_idx"
ON "MetadataEnrichmentJob"("status", "updatedAt");

CREATE INDEX "MetadataEnrichmentJob_libraryId_status_nextAttemptAt_idx"
ON "MetadataEnrichmentJob"("libraryId", "status", "nextAttemptAt");
