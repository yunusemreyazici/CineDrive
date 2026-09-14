ALTER TABLE "MusicPlaybackState" ADD COLUMN "volume" REAL NOT NULL DEFAULT 1;
ALTER TABLE "MusicPlaybackState" ADD COLUMN "playbackUpdatedAt" DATETIME;
