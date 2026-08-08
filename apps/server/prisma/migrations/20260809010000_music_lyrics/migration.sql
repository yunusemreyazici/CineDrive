-- CreateTable
CREATE TABLE "MusicLyrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'sidecar',
    "language" TEXT,
    "isSynced" BOOLEAN NOT NULL DEFAULT false,
    "offsetMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicLyrics_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MusicLyrics_trackId_key" ON "MusicLyrics"("trackId");

-- CreateIndex
CREATE INDEX "MusicLyrics_language_idx" ON "MusicLyrics"("language");
