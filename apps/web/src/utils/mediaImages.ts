import type { MediaItemType } from '../types/media';

/**
 * Artwork either comes back from the metadata provider as an absolute URL, or
 * lives in Drive and has to be proxied through the server. Every card and hero
 * used to re-derive this, which is how some of them ended up supporting only
 * one of the two sources.
 */
type MediaArtworkSource = Pick<
  MediaItemType,
  'posterUrl' | 'posterDriveFileId' | 'backdropUrl' | 'backdropDriveFileId'
>;

const driveAssetUrl = (driveFileId?: string) =>
  driveFileId ? `/api/media/assets/${driveFileId}` : null;

export const getPosterUrl = (media: MediaArtworkSource): string | null =>
  media.posterUrl || driveAssetUrl(media.posterDriveFileId);

export const getBackdropUrl = (media: MediaArtworkSource): string | null =>
  media.backdropUrl || driveAssetUrl(media.backdropDriveFileId);

/** Wide artwork with a portrait poster fallback, for landscape cards and heroes. */
export const getWideArtworkUrl = (media: MediaArtworkSource): string | null =>
  getBackdropUrl(media) || getPosterUrl(media);

/** Portrait artwork with a wide fallback, for detail pages that always need a backdrop. */
export const getHeroArtworkUrl = (media: MediaArtworkSource): string | null =>
  media.backdropUrl || media.posterUrl || getBackdropUrl(media) || getPosterUrl(media);
