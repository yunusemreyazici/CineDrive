ALTER TABLE "DriveFile" ADD COLUMN "audioBitDepth" INTEGER;
ALTER TABLE "DriveFile" ADD COLUMN "audioLossless" BOOLEAN;

ALTER TABLE "MusicTrack" ADD COLUMN "replayGainTrackDb" REAL;
ALTER TABLE "MusicTrack" ADD COLUMN "replayGainTrackPeak" REAL;
ALTER TABLE "MusicTrack" ADD COLUMN "replayGainAlbumDb" REAL;
ALTER TABLE "MusicTrack" ADD COLUMN "replayGainAlbumPeak" REAL;
