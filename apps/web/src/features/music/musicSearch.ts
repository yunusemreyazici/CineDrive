import type { MusicTrackDto } from '@cinedrive/shared';

const searchKey = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i');

/** Local metadata search only: does not reorder entries or make a provider request. */
export function musicTrackMatcher(query: string): (track: MusicTrackDto) => boolean {
  const words = searchKey(query).trim().split(/\s+/).filter(Boolean);
  return (track) => {
    if (!words.length) return true;
    const text = searchKey(
      [
        track.title,
        track.primaryArtist?.name,
        track.album?.title,
        ...track.artists.map((artist) => artist.name),
      ]
        .filter(Boolean)
        .join(' '),
    );
    return words.every((word) => text.includes(word));
  };
}
