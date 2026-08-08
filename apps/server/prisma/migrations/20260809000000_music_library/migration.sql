-- AlterTable
ALTER TABLE "DriveFile" ADD COLUMN "audioBitrate" INTEGER;
ALTER TABLE "DriveFile" ADD COLUMN "audioSampleRate" INTEGER;

-- CreateTable
CREATE TABLE "MusicArtwork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicArtwork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicArtist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sortName" TEXT,
    "musicbrainzId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicAlbum" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "artistId" TEXT,
    "artworkId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "year" INTEGER,
    "genres" TEXT,
    "musicbrainzReleaseId" TEXT,
    "musicbrainzReleaseGroupId" TEXT,
    "metadataStatus" TEXT NOT NULL DEFAULT 'local',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicAlbum_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicAlbum_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "MusicArtist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MusicAlbum_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "MusicArtwork" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "albumId" TEXT,
    "primaryArtistId" TEXT,
    "artworkId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "discNumber" INTEGER NOT NULL DEFAULT 1,
    "trackNumber" INTEGER NOT NULL DEFAULT 0,
    "year" INTEGER,
    "genres" TEXT,
    "duration" REAL,
    "musicbrainzRecordingId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicTrack_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicTrack_driveFileId_fkey" FOREIGN KEY ("driveFileId") REFERENCES "DriveFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicTrack_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "MusicAlbum" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MusicTrack_primaryArtistId_fkey" FOREIGN KEY ("primaryArtistId") REFERENCES "MusicArtist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MusicTrack_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "MusicArtwork" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicTrackArtist" (
    "trackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("trackId", "artistId"),
    CONSTRAINT "MusicTrackArtist_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicTrackArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "MusicArtist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicFavorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicFavorite_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "listenedSeconds" REAL NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicHistory_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicPlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicPlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicPlaylistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicPlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MusicPlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicPlaylistItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicPlaybackState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "currentTrackId" TEXT,
    "currentQueueItemId" TEXT,
    "positionSeconds" REAL NOT NULL DEFAULT 0,
    "shuffleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "repeatMode" TEXT NOT NULL DEFAULT 'off',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicPlaybackState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicPlaybackState_currentTrackId_fkey" FOREIGN KEY ("currentTrackId") REFERENCES "MusicTrack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playbackStateId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "playOrder" INTEGER NOT NULL,
    CONSTRAINT "MusicQueueItem_playbackStateId_fkey" FOREIGN KEY ("playbackStateId") REFERENCES "MusicPlaybackState" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicQueueItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MusicArtwork_userId_idx" ON "MusicArtwork"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicArtwork_userId_checksum_key" ON "MusicArtwork"("userId", "checksum");

-- CreateIndex
CREATE INDEX "MusicArtist_userId_name_idx" ON "MusicArtist"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MusicArtist_userId_normalizedName_key" ON "MusicArtist"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "MusicAlbum_userId_title_idx" ON "MusicAlbum"("userId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "MusicAlbum_userId_artistId_normalizedTitle_key" ON "MusicAlbum"("userId", "artistId", "normalizedTitle");

-- CreateIndex
CREATE UNIQUE INDEX "MusicTrack_driveFileId_key" ON "MusicTrack"("driveFileId");

-- CreateIndex
CREATE INDEX "MusicTrack_libraryId_idx" ON "MusicTrack"("libraryId");

-- CreateIndex
CREATE INDEX "MusicTrack_albumId_discNumber_trackNumber_idx" ON "MusicTrack"("albumId", "discNumber", "trackNumber");

-- CreateIndex
CREATE INDEX "MusicTrack_primaryArtistId_idx" ON "MusicTrack"("primaryArtistId");

-- CreateIndex
CREATE INDEX "MusicTrack_normalizedTitle_idx" ON "MusicTrack"("normalizedTitle");

-- CreateIndex
CREATE INDEX "MusicTrackArtist_artistId_idx" ON "MusicTrackArtist"("artistId");

-- CreateIndex
CREATE INDEX "MusicFavorite_userId_createdAt_idx" ON "MusicFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MusicFavorite_userId_trackId_key" ON "MusicFavorite"("userId", "trackId");

-- CreateIndex
CREATE INDEX "MusicHistory_userId_playedAt_idx" ON "MusicHistory"("userId", "playedAt");

-- CreateIndex
CREATE INDEX "MusicPlaylist_userId_updatedAt_idx" ON "MusicPlaylist"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "MusicPlaylistItem_trackId_idx" ON "MusicPlaylistItem"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicPlaylistItem_playlistId_position_key" ON "MusicPlaylistItem"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "MusicPlaybackState_userId_key" ON "MusicPlaybackState"("userId");

-- CreateIndex
CREATE INDEX "MusicQueueItem_trackId_idx" ON "MusicQueueItem"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicQueueItem_playbackStateId_sourceOrder_key" ON "MusicQueueItem"("playbackStateId", "sourceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MusicQueueItem_playbackStateId_playOrder_key" ON "MusicQueueItem"("playbackStateId", "playOrder");
