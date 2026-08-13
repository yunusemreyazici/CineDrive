-- Give artists their own persisted artwork instead of borrowing an arbitrary
-- album cover. Source metadata is kept for Wikimedia attribution and manual
-- uploads lock the selection against later automatic replacements.
ALTER TABLE "MusicArtist" ADD COLUMN "artworkId" TEXT REFERENCES "MusicArtwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MusicArtist" ADD COLUMN "artworkSource" TEXT;
ALTER TABLE "MusicArtist" ADD COLUMN "artworkSourceUrl" TEXT;
ALTER TABLE "MusicArtist" ADD COLUMN "artworkAttribution" TEXT;
ALTER TABLE "MusicArtist" ADD COLUMN "artworkLicense" TEXT;
ALTER TABLE "MusicArtist" ADD COLUMN "artworkLocked" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "MusicArtist_artworkId_idx" ON "MusicArtist"("artworkId");
