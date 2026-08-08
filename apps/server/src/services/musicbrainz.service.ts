const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2';
const COVER_ART_BASE = 'https://coverartarchive.org';
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface ReleaseGroupResult {
  id: string;
  score?: number;
  title: string;
  'first-release-date'?: string;
  'artist-credit'?: Array<{ artist?: { id?: string; name?: string } }>;
  tags?: Array<{ name: string; count?: number }>;
  releases?: Array<{ id: string }>;
}

export interface MusicBrainzAlbumMetadata {
  releaseGroupId: string;
  releaseId?: string;
  artistId?: string;
  year?: number;
  genres: string[];
  artwork?: { mimeType: string; data: Buffer };
}

export class MusicBrainzService {
  private chain = Promise.resolve();
  private lastRequestAt = 0;
  private cache = new Map<string, MusicBrainzAlbumMetadata | null>();

  public enrichAlbum(artist: string, album: string) {
    if (process.env.MUSIC_METADATA_ONLINE === 'false') return Promise.resolve(null);
    const key = `${normalize(artist)}::${normalize(album)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const task = this.chain.then(() => this.fetchAlbum(artist, album)).catch(() => null);
    this.chain = task.then(() => undefined);
    return task.then((result) => {
      this.cache.set(key, result);
      return result;
    });
  }

  private async throttledFetch(url: string) {
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    const headers = {
      'User-Agent': 'CineDrive/1.0.0 (https://github.com/yunusemreyazici/CineDrive)',
      Accept: 'application/json',
    };
    let response = await fetch(url, { headers });
    if (response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      this.lastRequestAt = Date.now();
      response = await fetch(url, { headers });
    }
    return response;
  }

  private async fetchAlbum(artist: string, album: string): Promise<MusicBrainzAlbumMetadata | null> {
    const query = encodeURIComponent(`releasegroup:${album} AND artist:${artist}`);
    const response = await this.throttledFetch(`${MUSICBRAINZ_BASE}/release-group/?query=${query}&fmt=json&limit=5`);
    if (!response.ok) return null;
    const payload = await response.json() as { 'release-groups'?: ReleaseGroupResult[] };
    const match = payload['release-groups']?.find((candidate) => {
      const candidateArtist = candidate['artist-credit']?.[0]?.artist?.name || '';
      return (candidate.score || 0) >= 90 && normalize(candidate.title) === normalize(album) && normalize(candidateArtist) === normalize(artist);
    });
    if (!match) return null;
    const releaseId = match.releases?.[0]?.id;
    return {
      releaseGroupId: match.id,
      releaseId,
      artistId: match['artist-credit']?.[0]?.artist?.id,
      year: Number.parseInt(match['first-release-date']?.slice(0, 4) || '', 10) || undefined,
      genres: (match.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 5).map((tag) => tag.name),
      artwork: await this.fetchArtwork(match.id),
    };
  }

  private async fetchArtwork(releaseGroupId: string) {
    const response = await this.throttledFetch(`${COVER_ART_BASE}/release-group/${releaseGroupId}`);
    if (!response.ok) return undefined;
    const payload = await response.json() as { images?: Array<{ front?: boolean; thumbnails?: Record<string, string> }> };
    const image = payload.images?.find((candidate) => candidate.front) || payload.images?.[0];
    const url = image?.thumbnails?.['500'] || image?.thumbnails?.['250'];
    if (!url) return undefined;
    const imageResponse = await this.throttledFetch(url);
    if (!imageResponse.ok) return undefined;
    const data = Buffer.from(await imageResponse.arrayBuffer());
    if (data.length > MAX_ARTWORK_BYTES) return undefined;
    return { mimeType: imageResponse.headers.get('content-type') || 'image/jpeg', data };
  }
}
