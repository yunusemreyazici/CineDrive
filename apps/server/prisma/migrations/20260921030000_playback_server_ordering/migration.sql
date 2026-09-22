ALTER TABLE "PlaybackProgress" ADD COLUMN "clientInstanceId" TEXT;
ALTER TABLE "PlaybackProgress" ADD COLUMN "clientSequence" INTEGER;
ALTER TABLE "PlaybackProgress" ADD COLUMN "serverRevision" INTEGER NOT NULL DEFAULT 0;
