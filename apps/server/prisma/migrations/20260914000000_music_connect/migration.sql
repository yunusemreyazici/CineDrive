ALTER TABLE "MusicPlaybackState" ADD COLUMN "connectEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MusicPlaybackState" ADD COLUMN "remoteControlAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MusicPlaybackState" ADD COLUMN "isPlaying" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MusicPlaybackState" ADD COLUMN "lastSeenAt" DATETIME;

CREATE TABLE "MusicPlaybackCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceClientId" TEXT NOT NULL,
    "targetClientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "MusicPlaybackCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MusicPlaybackCommand_userId_targetClientId_status_createdAt_idx" ON "MusicPlaybackCommand"("userId", "targetClientId", "status", "createdAt");
CREATE INDEX "MusicPlaybackCommand_expiresAt_idx" ON "MusicPlaybackCommand"("expiresAt");
