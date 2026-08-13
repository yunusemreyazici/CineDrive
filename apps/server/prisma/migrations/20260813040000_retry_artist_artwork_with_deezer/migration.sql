UPDATE "MusicArtist"
SET
  "artworkLookupStatus" = 'pending',
  "artworkLookupAt" = NULL
WHERE
  "artworkId" IS NULL
  AND "artworkLocked" = 0
  AND "artworkLookupStatus" IN ('not-found', 'failed');
