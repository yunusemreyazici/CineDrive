ALTER TABLE "MusicTrack" ADD COLUMN "lyricsEnrichmentStatus" TEXT;
ALTER TABLE "MusicTrack" ADD COLUMN "lyricsEnrichmentAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MusicTrack" ADD COLUMN "lyricsEnrichmentRetryAt" DATETIME;
ALTER TABLE "MusicTrack" ADD COLUMN "lyricsEnrichmentUpdatedAt" DATETIME;

CREATE INDEX "MusicTrack_lyricsEnrichmentStatus_lyricsEnrichmentRetryAt_idx"
ON "MusicTrack"("lyricsEnrichmentStatus", "lyricsEnrichmentRetryAt");
