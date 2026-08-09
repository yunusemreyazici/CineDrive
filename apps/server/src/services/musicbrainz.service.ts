const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2';
const COVER_ART_BASE = 'https://coverartarchive.org';
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface ReleaseGroupResult {
  id: string;
  score?: number;
  title: string;
  'first-release-date'?: string;
  'artist-credit'?: Array<{ artist?: { id?: string; name?: string } }>;
  tags?: Array<{ name: string; count?: number }>;
  releases?: Array<{ id: string }>;
  'primary-type'?: string;
  'secondary-types'?: string[];
}

export interface MusicBrainzAlbumMetadata {
  releaseGroupId: string;
  releaseId?: string;
  artistId?: string;
  year?: number;
  genres: string[];
  releaseType?: string;
  secondaryTypes: string[];
  artwork?: { mimeType: string; data: Buffer };
}

export interface MusicBrainzCredit {
  name: string;
  role: string;
  instrument?: string;
  musicbrainzId?: string;
}

export interface MusicBrainzRecordingMetadata {
  recordingId: string;
  credits: MusicBrainzCredit[];
}

interface ArtistRelation {
  type?: string;
  attributes?: string[];
  artist?: { id?: string; name?: string };
}

interface WorkRelation {
  type?: string;
  work?: { relations?: ArtistRelation[] };
}

interface RecordingResult {
  id: string;
  score?: number;
  title: string;
  length?: number;
  'artist-credit'?: Array<{ artist?: { id?: string; name?: string } }>;
  relations?: Array<ArtistRelation | WorkRelation>;
}

export class MusicBrainzService {
  private chain = Promise.resolve();
  private lastRequestAt = 0;
  private cache = new Map<string, MusicBrainzAlbumMetadata | null>();
  private recordingCache = new Map<string, MusicBrainzRecordingMetadata | null>();

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

  public enrichRecording(input: {
    recordingId?: string | null;
    title: string;
    artist: string;
    album?: string | null;
    duration?: number | null;
  }) {
    if (process.env.MUSIC_METADATA_ONLINE === 'false') return Promise.resolve(null);
    const key = input.recordingId || `${normalize(input.artist)}::${normalize(input.title)}`;
    const cached = this.recordingCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const task = this.chain.then(() => this.fetchRecording(input)).catch(() => null);
    this.chain = task.then(() => undefined);
    return task.then((result) => {
      this.recordingCache.set(key, result);
      return result;
    });
  }

  public fetchCoverArtwork(releaseGroupId: string) {
    return this.fetchArtwork(releaseGroupId);
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

  private async fetchAlbum(
    artist: string,
    album: string,
  ): Promise<MusicBrainzAlbumMetadata | null> {
    const query = encodeURIComponent(`releasegroup:${album} AND artist:${artist}`);
    const response = await this.throttledFetch(
      `${MUSICBRAINZ_BASE}/release-group/?query=${query}&fmt=json&limit=5`,
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { 'release-groups'?: ReleaseGroupResult[] };
    const match = payload['release-groups']?.find((candidate) => {
      const candidateArtist = candidate['artist-credit']?.[0]?.artist?.name || '';
      return (
        (candidate.score || 0) >= 90 &&
        normalize(candidate.title) === normalize(album) &&
        normalize(candidateArtist) === normalize(artist)
      );
    });
    if (!match) return null;
    const releaseId = match.releases?.[0]?.id;
    return {
      releaseGroupId: match.id,
      releaseId,
      artistId: match['artist-credit']?.[0]?.artist?.id,
      year: Number.parseInt(match['first-release-date']?.slice(0, 4) || '', 10) || undefined,
      genres: (match.tags || [])
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .slice(0, 5)
        .map((tag) => tag.name),
      releaseType: match['primary-type']?.toLowerCase(),
      secondaryTypes: (match['secondary-types'] || []).map((type) => type.toLowerCase()),
      artwork: await this.fetchArtwork(match.id),
    };
  }

  private async fetchRecording(input: {
    recordingId?: string | null;
    title: string;
    artist: string;
    album?: string | null;
    duration?: number | null;
  }): Promise<MusicBrainzRecordingMetadata | null> {
    let recordingId = input.recordingId || undefined;
    if (!recordingId) {
      const terms = [
        `recording:${JSON.stringify(input.title)}`,
        `artist:${JSON.stringify(input.artist)}`,
      ];
      if (input.album) terms.push(`release:${JSON.stringify(input.album)}`);
      const response = await this.throttledFetch(
        `${MUSICBRAINZ_BASE}/recording/?query=${encodeURIComponent(terms.join(' AND '))}&fmt=json&limit=5`,
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { recordings?: RecordingResult[] };
      const match = payload.recordings?.find((candidate) => {
        const artist = candidate['artist-credit']?.[0]?.artist?.name || '';
        const durationMatches =
          !input.duration ||
          !candidate.length ||
          Math.abs(candidate.length / 1000 - input.duration) <= 5;
        return (
          (candidate.score || 0) >= 90 &&
          normalize(candidate.title) === normalize(input.title) &&
          normalize(artist) === normalize(input.artist) &&
          durationMatches
        );
      });
      recordingId = match?.id;
    }
    if (!recordingId) return null;
    const response = await this.throttledFetch(
      `${MUSICBRAINZ_BASE}/recording/${recordingId}?inc=artist-rels+work-rels+work-level-rels&fmt=json`,
    );
    if (!response.ok) return null;
    const recording = (await response.json()) as RecordingResult;
    const recordingRelations = recording.relations || [];
    const artistRelations = recordingRelations.filter(
      (relation): relation is ArtistRelation => 'artist' in relation,
    );
    const workArtistRelations = recordingRelations.flatMap((relation) =>
      'work' in relation ? relation.work?.relations || [] : [],
    );
    const toCredit = (relation: ArtistRelation): MusicBrainzCredit | null => {
      const name = relation.artist?.name;
      if (!name || !relation.type) return null;
      const roleMap: Record<string, string> = {
        composer: 'composer',
        lyricist: 'lyricist',
        writer: 'songwriter',
        producer: 'producer',
        arranger: 'arranger',
        remixer: 'remixer',
        mix: 'mixer',
        engineer: 'engineer',
        conductor: 'conductor',
        performer: 'performer',
        instrument: 'performer',
        vocals: 'performer',
      };
      const role = roleMap[relation.type.toLowerCase()];
      if (!role) return null;
      return {
        name,
        role,
        instrument: relation.attributes?.join(', ') || undefined,
        musicbrainzId: relation.artist?.id,
      };
    };
    const credits = [...artistRelations, ...workArtistRelations]
      .map(toCredit)
      .filter((credit): credit is MusicBrainzCredit => !!credit)
      .filter(
        (credit, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.name === credit.name &&
              candidate.role === credit.role &&
              candidate.instrument === credit.instrument,
          ) === index,
      );
    return { recordingId, credits };
  }

  private async fetchArtwork(releaseGroupId: string) {
    const response = await this.throttledFetch(`${COVER_ART_BASE}/release-group/${releaseGroupId}`);
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      images?: Array<{ front?: boolean; thumbnails?: Record<string, string> }>;
    };
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
