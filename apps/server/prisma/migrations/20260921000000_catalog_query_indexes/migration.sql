CREATE INDEX "DriveFile_libraryId_status_idx"
ON "DriveFile"("libraryId", "status");

CREATE INDEX "MediaItem_libraryId_type_createdAt_idx"
ON "MediaItem"("libraryId", "type", "createdAt");

CREATE INDEX "Episode_mediaItemId_idx"
ON "Episode"("mediaItemId");

CREATE INDEX "SubtitleTrack_mediaItemId_idx"
ON "SubtitleTrack"("mediaItemId");

CREATE INDEX "SubtitleTrack_episodeId_idx"
ON "SubtitleTrack"("episodeId");

CREATE INDEX "LibraryScan_libraryId_startedAt_idx"
ON "LibraryScan"("libraryId", "startedAt");
