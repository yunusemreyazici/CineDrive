const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2';
const COVER_ART_BASE = 'https://coverartarchive.org';
const WIKIDATA_ENTITY_BASE = 'https://www.wikidata.org/wiki/Special:EntityData';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
const MAX_ARTIST_IMAGE_BYTES = 8 * 1024 * 1024;

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

interface ArtistSearchResult {
  id: string;
  name: string;
  score?: number;
  'sort-name'?: string;
  type?: string;
  disambiguation?: string;
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

export interface MusicBrainzArtistArtwork {
  musicbrainzId: string;
  wikidataId?: string;
  sourceUrl: string;
  previewUrl: string;
  attribution?: string;
  license?: string;
  artwork: { mimeType: string; data: Buffer };
}

export interface MusicBrainzArtistIdentity {
  musicbrainzId: string;
  name: string;
  sortName?: string;
  type?: string;
  disambiguation?: string;
  confidence: number;
}

interface UrlRelation {
  type?: string;
  url?: { resource?: string };
}

interface WikidataImageClaim {
  mainsnak?: { datavalue?: { value?: unknown } };
  rank?: string;
}

interface WikidataEntity {
  claims?: {
    P18?: WikidataImageClaim[];
    P154?: WikidataImageClaim[];
  };
  sitelinks?: Record<string, { site?: string; title?: string; url?: string }>;
}

interface WikimediaImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, { value?: string }>;
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
  private artistArtworkCache = new Map<string, MusicBrainzArtistArtwork | null>();
  private artistIdentityCache = new Map<string, MusicBrainzArtistIdentity | null>();

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

  public enrichArtistArtwork(musicbrainzId: string) {
    if (process.env.MUSIC_METADATA_ONLINE === 'false') return Promise.resolve(null);
    const cached = this.artistArtworkCache.get(musicbrainzId);
    if (cached !== undefined) return Promise.resolve(cached);
    const task = this.chain.then(() => this.fetchArtistArtwork(musicbrainzId)).catch(() => null);
    this.chain = task.then(() => undefined);
    return task.then((result) => {
      if (result) this.artistArtworkCache.set(musicbrainzId, result);
      return result;
    });
  }

  public matchArtistIdentity(name: string) {
    if (process.env.MUSIC_METADATA_ONLINE === 'false') return Promise.resolve(null);
    const key = normalize(name);
    if (!key) return Promise.resolve(null);
    const cached = this.artistIdentityCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const task = this.chain.then(() => this.fetchArtistIdentity(name)).catch(() => null);
    this.chain = task.then(() => undefined);
    return task.then((result) => {
      this.artistIdentityCache.set(key, result);
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

  private async fetchArtistIdentity(name: string): Promise<MusicBrainzArtistIdentity | null> {
    const query = encodeURIComponent(`artist:${JSON.stringify(name)}`);
    const response = await this.throttledFetch(
      `${MUSICBRAINZ_BASE}/artist/?query=${query}&fmt=json&limit=5`,
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { artists?: ArtistSearchResult[] };
    const normalizedName = normalize(name);
    const exactMatches = (payload.artists || []).filter(
      (candidate) =>
        candidate.score === 100 && normalize(candidate.name) === normalizedName && candidate.id,
    );
    const uniqueIds = new Set(exactMatches.map((candidate) => candidate.id));
    if (exactMatches.length !== 1 || uniqueIds.size !== 1) return null;
    const match = exactMatches[0]!;
    return {
      musicbrainzId: match.id,
      name: match.name,
      sortName: match['sort-name'],
      type: match.type,
      disambiguation: match.disambiguation,
      confidence: match.score || 100,
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

  private async fetchArtistArtwork(
    musicbrainzId: string,
  ): Promise<MusicBrainzArtistArtwork | null> {
    const artistResponse = await this.throttledFetch(
      `${MUSICBRAINZ_BASE}/artist/${encodeURIComponent(musicbrainzId)}?inc=url-rels&fmt=json`,
    );
    if (!artistResponse.ok) return null;
    const artist = (await artistResponse.json()) as { relations?: UrlRelation[] };
    const wikidataUrl = artist.relations?.find(
      (relation) => relation.type === 'wikidata' && relation.url?.resource,
    )?.url?.resource;
    const linkedWikidataId = wikidataUrl?.match(/\/(?:wiki|entity)\/(Q\d+)(?:$|[?#/])/)?.[1];

    const headers = {
      'User-Agent': 'CineDrive/1.0.0 (https://github.com/yunusemreyazici/CineDrive)',
      Accept: 'application/json',
    };
    const wikidataId = linkedWikidataId || (await this.findWikidataId(musicbrainzId, headers));
    if (wikidataId) {
      const entityResponse = await fetch(
        `${WIKIDATA_ENTITY_BASE}/${encodeURIComponent(wikidataId)}.json`,
        { headers },
      );
      if (entityResponse.ok) {
        const entityPayload = (await entityResponse.json()) as {
          entities?: Record<string, WikidataEntity>;
        };
        const entity = entityPayload.entities?.[wikidataId];
        if (entity) {
          const portrait = this.preferredImageName(entity.claims?.P18);
          if (portrait) {
            const result = await this.fetchWikimediaFile({
              apiUrl: COMMONS_API,
              fileName: portrait,
              musicbrainzId,
              wikidataId,
              headers,
            });
            if (result) return result;
          }

          const pageImage = await this.fetchWikipediaPageImage({
            entity,
            musicbrainzId,
            wikidataId,
            headers,
          });
          if (pageImage) return pageImage;

          const logo = this.preferredImageName(entity.claims?.P154);
          if (logo) {
            const result = await this.fetchWikimediaFile({
              apiUrl: COMMONS_API,
              fileName: logo,
              musicbrainzId,
              wikidataId,
              headers,
            });
            if (result) return result;
          }
        }
      }
    }

    const directCommonsFile = artist.relations
      ?.filter((relation) => relation.type === 'image' && relation.url?.resource)
      .map((relation) => this.commonsFileName(relation.url?.resource || ''))
      .find((fileName): fileName is string => !!fileName);
    if (!directCommonsFile) return null;
    return this.fetchWikimediaFile({
      apiUrl: COMMONS_API,
      fileName: directCommonsFile,
      musicbrainzId,
      wikidataId,
      headers,
    });
  }

  private async findWikidataId(musicbrainzId: string, headers: Record<string, string>) {
    const url = new URL(WIKIDATA_API);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'search',
      srnamespace: '0',
      srlimit: '2',
      srsearch: `haswbstatement:P434=${musicbrainzId}`,
    }).toString();
    const response = await fetch(url, { headers });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      query?: { search?: Array<{ title?: string }> };
    };
    const ids = [
      ...new Set(
        (payload.query?.search || [])
          .map((result) => result.title)
          .filter((title): title is string => !!title && /^Q\d+$/.test(title)),
      ),
    ];
    return ids.length === 1 ? ids[0] : undefined;
  }

  private preferredImageName(claims?: WikidataImageClaim[]) {
    const claim = claims
      ?.filter((candidate) => candidate.rank !== 'deprecated')
      .sort((left, right) => Number(right.rank === 'preferred') - Number(left.rank === 'preferred'))
      .find((candidate) => typeof candidate.mainsnak?.datavalue?.value === 'string');
    const value = claim?.mainsnak?.datavalue?.value;
    return typeof value === 'string' ? value : undefined;
  }

  private async fetchWikipediaPageImage(input: {
    entity: WikidataEntity;
    musicbrainzId: string;
    wikidataId: string;
    headers: Record<string, string>;
  }) {
    const sitelinks = Object.entries(input.entity.sitelinks || {})
      .filter(([site, link]) => site.endsWith('wiki') && !!link.title && !!link.url)
      .sort(([left], [right]) => {
        const priority = (site: string) => (site === 'trwiki' ? 0 : site === 'enwiki' ? 1 : 2);
        return priority(left) - priority(right);
      })
      .slice(0, 3);
    for (const [, sitelink] of sitelinks) {
      let pageUrl: URL;
      try {
        pageUrl = new URL(sitelink.url || '');
      } catch {
        continue;
      }
      if (pageUrl.protocol !== 'https:' || !pageUrl.hostname.endsWith('.wikipedia.org')) continue;
      const apiUrl = `${pageUrl.origin}/w/api.php`;
      const queryUrl = new URL(apiUrl);
      queryUrl.search = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'pageimages',
        piprop: 'name',
        pilicense: 'free',
        titles: sitelink.title || '',
      }).toString();
      const response = await fetch(queryUrl, { headers: input.headers });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        query?: { pages?: Record<string, { pageimage?: string }> };
      };
      const fileName = Object.values(payload.query?.pages || {})[0]?.pageimage;
      if (!fileName) continue;
      const result = await this.fetchWikimediaFile({
        apiUrl,
        fileName,
        musicbrainzId: input.musicbrainzId,
        wikidataId: input.wikidataId,
        headers: input.headers,
      });
      if (result) return result;
    }
    return null;
  }

  private commonsFileName(resource: string) {
    try {
      const url = new URL(resource);
      if (url.protocol !== 'https:' || url.hostname !== 'commons.wikimedia.org') return undefined;
      const match = decodeURIComponent(url.pathname).match(/\/wiki\/File:(.+)$/i);
      return match?.[1]?.replace(/_/g, ' ');
    } catch {
      return undefined;
    }
  }

  private async fetchWikimediaFile(input: {
    apiUrl: string;
    fileName: string;
    musicbrainzId: string;
    wikidataId?: string;
    headers: Record<string, string>;
  }): Promise<MusicBrainzArtistArtwork | null> {
    const commonsUrl = new URL(input.apiUrl);
    commonsUrl.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '1200',
      titles: `File:${input.fileName}`,
    }).toString();
    const commonsResponse = await fetch(commonsUrl, { headers: input.headers });
    if (!commonsResponse.ok) return null;
    const commonsPayload = (await commonsResponse.json()) as {
      query?: {
        pages?: Record<string, { imageinfo?: WikimediaImageInfo[] }>;
      };
    };
    const imageInfo = Object.values(commonsPayload.query?.pages || {})[0]?.imageinfo?.[0];
    const imageUrl = imageInfo?.thumburl || imageInfo?.url;
    if (!imageUrl) return null;
    const imageResponse = await fetch(imageUrl, {
      headers: { ...input.headers, Accept: 'image/*' },
    });
    if (!imageResponse.ok) return null;
    const contentLength = Number(imageResponse.headers.get('content-length') || 0);
    if (contentLength > MAX_ARTIST_IMAGE_BYTES) return null;
    const data = Buffer.from(await imageResponse.arrayBuffer());
    if (!data.length || data.length > MAX_ARTIST_IMAGE_BYTES) return null;
    const mimeType = imageResponse.headers.get('content-type') || imageInfo.mime || 'image/jpeg';
    if (!mimeType.startsWith('image/')) return null;
    const cleanMetadata = (value?: string) =>
      value
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    const metadata = imageInfo.extmetadata || {};
    return {
      musicbrainzId: input.musicbrainzId,
      wikidataId: input.wikidataId,
      sourceUrl:
        imageInfo.descriptionurl ||
        `${new URL(input.apiUrl).origin}/wiki/File:${encodeURIComponent(input.fileName)}`,
      previewUrl: imageUrl,
      attribution: cleanMetadata(metadata.Artist?.value || metadata.Credit?.value),
      license: cleanMetadata(metadata.LicenseShortName?.value),
      artwork: { mimeType, data },
    };
  }
}
