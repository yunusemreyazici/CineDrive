ALTER TABLE "PlaybackProgress" ADD COLUMN "trackingKey" TEXT NOT NULL DEFAULT '__media__';
UPDATE "PlaybackProgress" SET "trackingKey" = "episodeId" WHERE "episodeId" IS NOT NULL;
-- The old nullable unique constraint allowed duplicate NULL rows. Keep the
-- newest row for each logical key before adding the non-null unique index.
DELETE FROM "PlaybackProgress"
WHERE rowid IN (
  SELECT "rowid"
  FROM (
    SELECT rowid,
           ROW_NUMBER() OVER (
             PARTITION BY "userId", "mediaItemId", "trackingKey"
             ORDER BY "lastPlayedAt" DESC, "updatedAt" DESC, rowid DESC
           ) AS duplicate_rank
    FROM "PlaybackProgress"
  )
  WHERE duplicate_rank > 1
);
CREATE UNIQUE INDEX "PlaybackProgress_userId_mediaItemId_trackingKey_key"
  ON "PlaybackProgress"("userId", "mediaItemId", "trackingKey");

ALTER TABLE "WatchHistory" ADD COLUMN "trackingKey" TEXT NOT NULL DEFAULT '__media__';
UPDATE "WatchHistory" SET "trackingKey" = "episodeId" WHERE "episodeId" IS NOT NULL;
DELETE FROM "WatchHistory"
WHERE rowid IN (
  SELECT "rowid"
  FROM (
    SELECT rowid,
           ROW_NUMBER() OVER (
             PARTITION BY "userId", "mediaItemId", "trackingKey"
             ORDER BY "watchedAt" DESC, "updatedAt" DESC, rowid DESC
           ) AS duplicate_rank
    FROM "WatchHistory"
  )
  WHERE duplicate_rank > 1
);
CREATE UNIQUE INDEX "WatchHistory_userId_mediaItemId_trackingKey_key"
  ON "WatchHistory"("userId", "mediaItemId", "trackingKey");
