CREATE INDEX "PlaybackProgress_userId_mediaItemId_lastPlayedAt_idx"
ON "PlaybackProgress"("userId", "mediaItemId", "lastPlayedAt");
