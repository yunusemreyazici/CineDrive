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

/**
 * The metadata provider serves the same image at several widths through the
 * path segment. Backdrops arrived as `w1280` everywhere, including in the
 * 280px continue-watching cards, so a rail of ten cards pulled megabytes to
 * paint thumbnails. Artwork proxied from Drive has no such variants and is
 * returned untouched.
 */
export type ArtworkWidth = 'w300' | 'w500' | 'w780' | 'w1280';

const TMDB_SIZED_URL = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(w\d+|original)(\/.+)$/;

export const sizedArtworkUrl = (url: string | null, width: ArtworkWidth): string | null =>
  url ? url.replace(TMDB_SIZED_URL, `$1${width}$3`) : url;

export const getPosterUrl = (media: MediaArtworkSource): string | null =>
  media.posterUrl || driveAssetUrl(media.posterDriveFileId);

export const getBackdropUrl = (media: MediaArtworkSource): string | null =>
  media.backdropUrl || driveAssetUrl(media.backdropDriveFileId);

/** Wide artwork with a portrait poster fallback, for landscape cards and heroes. */
export const getWideArtworkUrl = (
  media: MediaArtworkSource,
  width: ArtworkWidth = 'w1280',
): string | null => sizedArtworkUrl(getBackdropUrl(media) || getPosterUrl(media), width);

/** Portrait artwork with a wide fallback, for detail pages that always need a backdrop. */
export const getHeroArtworkUrl = (media: MediaArtworkSource): string | null =>
  media.backdropUrl || media.posterUrl || getBackdropUrl(media) || getPosterUrl(media);
