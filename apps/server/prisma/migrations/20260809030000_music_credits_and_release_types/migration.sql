ALTER TABLE "MusicAlbum" ADD COLUMN "releaseType" TEXT NOT NULL DEFAULT 'album';
ALTER TABLE "MusicAlbum" ADD COLUMN "secondaryTypes" TEXT;
ALTER TABLE "MusicTrack" ADD COLUMN "metadataLocked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MusicTrackCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "instrument" TEXT,
    "musicbrainzId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'tag',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicTrackCredit_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MusicTrackCredit_trackId_role_name_instrument_key" ON "MusicTrackCredit"("trackId", "role", "name", "instrument");
CREATE INDEX "MusicTrackCredit_trackId_position_idx" ON "MusicTrackCredit"("trackId", "position");
CREATE INDEX "MusicTrackCredit_musicbrainzId_idx" ON "MusicTrackCredit"("musicbrainzId");
