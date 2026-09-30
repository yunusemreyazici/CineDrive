-- Preserve every public queue ID, order and currentQueueItemId. No source
-- queue is deleted during transfer; the same entry ID can belong to two states.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MusicQueueItem" (
    "id" TEXT NOT NULL,
    "playbackStateId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "playOrder" INTEGER NOT NULL,
    PRIMARY KEY ("playbackStateId", "id"),
    CONSTRAINT "MusicQueueItem_playbackStateId_fkey" FOREIGN KEY ("playbackStateId") REFERENCES "MusicPlaybackState" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicQueueItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MusicQueueItem" ("id", "playbackStateId", "trackId", "sourceOrder", "playOrder")
SELECT "id", "playbackStateId", "trackId", "sourceOrder", "playOrder" FROM "MusicQueueItem";
DROP TABLE "MusicQueueItem";
ALTER TABLE "new_MusicQueueItem" RENAME TO "MusicQueueItem";
CREATE UNIQUE INDEX "MusicQueueItem_playbackStateId_sourceOrder_key" ON "MusicQueueItem"("playbackStateId", "sourceOrder");
CREATE UNIQUE INDEX "MusicQueueItem_playbackStateId_playOrder_key" ON "MusicQueueItem"("playbackStateId", "playOrder");
CREATE INDEX "MusicQueueItem_trackId_idx" ON "MusicQueueItem"("trackId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
