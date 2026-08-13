-- Remember artist-artwork lookup attempts so repeated maintenance scans move
-- through the whole library instead of retrying the same first candidates.
ALTER TABLE "MusicArtist" ADD COLUMN "artworkLookupStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "MusicArtist" ADD COLUMN "artworkLookupAt" DATETIME;

UPDATE "MusicArtist"
SET "artworkLookupStatus" = 'found', "artworkLookupAt" = CURRENT_TIMESTAMP
WHERE "artworkId" IS NOT NULL;
