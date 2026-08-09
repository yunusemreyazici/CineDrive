-- CreateTable
CREATE TABLE "MusicFingerprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "fingerprint" TEXT,
    "fingerprintHash" TEXT,
    "duration" REAL,
    "sourceModifiedAt" DATETIME,
    "acoustidId" TEXT,
    "acoustidScore" REAL,
    "matchedTitle" TEXT,
    "matchedArtist" TEXT,
    "musicbrainzRecordingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "analyzedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicFingerprint_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MusicFingerprint_trackId_key" ON "MusicFingerprint"("trackId");
CREATE INDEX "MusicFingerprint_fingerprintHash_duration_idx" ON "MusicFingerprint"("fingerprintHash", "duration");
CREATE INDEX "MusicFingerprint_status_analyzedAt_idx" ON "MusicFingerprint"("status", "analyzedAt");
CREATE INDEX "MusicFingerprint_acoustidId_idx" ON "MusicFingerprint"("acoustidId");
