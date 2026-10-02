-- Old receivers and already queued commands retain their legacy behavior.
ALTER TABLE "MusicPlaybackState" ADD COLUMN "supportsConditionalSeek" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MusicPlaybackCommand" ADD COLUMN "requiresConditionalSeek" BOOLEAN NOT NULL DEFAULT false;
