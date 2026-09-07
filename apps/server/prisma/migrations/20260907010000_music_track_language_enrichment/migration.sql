ALTER TABLE "MusicTrack" ADD COLUMN "languageCode" TEXT;
ALTER TABLE "MusicTrack" ADD COLUMN "languageSource" TEXT;
ALTER TABLE "MusicTrack" ADD COLUMN "languageConfidence" REAL;
ALTER TABLE "MusicTrack" ADD COLUMN "languageDetectionVersion" INTEGER;
ALTER TABLE "MusicTrack" ADD COLUMN "languageUpdatedAt" DATETIME;

CREATE INDEX "MusicTrack_languageCode_idx" ON "MusicTrack"("languageCode");
CREATE INDEX "MusicTrack_languageDetectionVersion_idx" ON "MusicTrack"("languageDetectionVersion");
