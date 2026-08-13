ALTER TABLE "MusicHistory" ADD COLUMN "eventId" TEXT;

CREATE UNIQUE INDEX "MusicHistory_userId_eventId_key"
ON "MusicHistory"("userId", "eventId");
