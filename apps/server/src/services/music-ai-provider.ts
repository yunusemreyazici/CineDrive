import { z } from 'zod';
import { musicEditorialPlansProviderSchema, playlistIntentProviderSchema } from '@cinedrive/shared';
import type { EnvConfig } from '@cinedrive/shared';

export interface MusicCatalogueSummary {
  totalTrackCount: number;
  availableGenres: Array<{ name: string; count: number }>;
  yearRange: { min: number; max: number } | null;
  decades: Array<{ decade: number; count: number }>;
}

export interface MusicEditorialListenerProfile {
  totalTrackCount: number;
  favoriteTrackCount: number;
  playedTrackCount: number;
  unheardTrackCount: number;
  underplayedTrackCount: number;
  meaningfulHistoryCount: number;
  genres: Array<{ name: string; count: number; affinity: number }>;
  decades: Array<{ decade: number; count: number; affinity: number }>;
  languages: Array<{ code: string; count: number }>;
}

export interface MusicAiProvider {
  generatePlaylistIntent(input: {
    prompt: string;
    catalogue: MusicCatalogueSummary;
  }): Promise<unknown>;
  generateEditorialPlans?(input: {
    catalogue: MusicCatalogueSummary;
    profile: MusicEditorialListenerProfile;
    locale: 'tr' | 'en';
    editionDate: string;
  }): Promise<unknown>;
}

export type MusicAiProviderFailure =
  'missing-api-key' | 'timeout' | 'rate-limited' | 'upstream' | 'malformed-response';

export class MusicAiProviderError extends Error {
  constructor(
    public readonly failure: MusicAiProviderFailure,
    public readonly upstreamStatus?: number,
  ) {
    super(`Music AI provider failure: ${failure}`);
    this.name = 'MusicAiProviderError';
  }
}

const completionResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({ message: z.object({ content: z.string().min(1) }).passthrough() }).passthrough(),
      )
      .min(1),
  })
  .passthrough();

export const buildMusicAiPlannerPrompt = (input: {
  prompt: string;
  catalogue: MusicCatalogueSummary;
}) => `You plan a playlist for a private local music catalogue.

Return only the requested PlaylistIntent JSON. Never name or select songs. Never invent track-level metadata. You have no tools and cannot access databases, files, secrets, or environment variables.

Interpret the listener's language faithfully. Explicit categorical facets—language, genre/family, decade/year range, and a named artist—are hard by default even when the listener does not say "only". Make only the specifically modified facet soft for phrases such as "ağırlıklı", "çoğunlukla", "biraz", "arada", "preferably", "mostly", "mainly", or "leaning toward". "Hariç", "olmasın", "except", "without", and "no" belong in an excluded array and are always hard. Subjective ideas such as calm, energetic, night driving, nostalgic, romantic, surprising, underplayed, or familiar are scoring biases, never hard filters. Prefer canonical genre names from availableGenres. Artist names may only come from the listener request. BPM, tempo, key, valence, acousticness, danceability, and energy are unavailable.

Keep language/locality separate from genre. For example, "Türkçe rock" means language.languages=["tr"] plus genre "rock", never a made-up combined genre; "sadece Türkçe rock" makes both hard. Use ISO 639 language codes and ISO 3166-1 alpha-2 country codes. Country/scene means artist/local-scene affinity, not proof of a song's language. Do not infer language from artist names or song titles.

All weights and biases are numbers from 0 to 1. targetCount defaults to 50 and must be 10-100. Keep title and subtitle concise and in the listener's language. excludedGenres and excludedArtistNames are always hard exclusions. Do not place exclusions in positive preference arrays.

Listener request:
${JSON.stringify(input.prompt)}

Bounded catalogue summary (contains no track, album, history, favorite, or artist lists):
${JSON.stringify(input.catalogue)}`;

export const buildMusicAiEditorialPrompt = (input: {
  catalogue: MusicCatalogueSummary;
  profile: MusicEditorialListenerProfile;
  locale: 'tr' | 'en';
  editionDate: string;
}) => `You are the editorial planner for a private, self-hosted music library.

Create exactly five distinct playlist plans for these slots: daily, rediscovery, comfort, crossover, time-capsule. Return only the requested JSON. Write concise titles and subtitles in ${input.locale === 'tr' ? 'Turkish' : 'English'}.

You plan themes only. Never name or select songs, albums, or artists. artists and excludedArtistNames must always be empty. You have no tools and cannot access databases, files, secrets, or environment variables. All positive genre, year, language and locale facets must be SOFT because the listener did not explicitly request a hard constraint. Keep exclusions empty. Do not claim knowledge of BPM, tempo, key, valence, acousticness, danceability, or energy.

Use the aggregate profile to make the five plans complementary: daily should balance familiarity and discovery; rediscovery should favor unheard, underplayed, or long-unplayed library items; comfort should lean toward favorites and familiarity while preserving diversity; crossover should blend two established genre affinities; time-capsule should softly favor one meaningful decade. targetCount should be 40-50. All weights and biases must be between 0 and 1.

Edition date: ${input.editionDate}

Bounded catalogue vocabulary (no track, album, artist, favorite-name, or history list):
${JSON.stringify(input.catalogue)}

Aggregate listener profile (counts and affinities only; no media identities):
${JSON.stringify(input.profile)}`;

export interface OpenAiCompatibleMusicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleMusicProvider implements MusicAiProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleMusicProviderOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  public async generatePlaylistIntent(input: {
    prompt: string;
    catalogue: MusicCatalogueSummary;
  }): Promise<unknown> {
    return this.generateStructured(
      buildMusicAiPlannerPrompt(input),
      playlistIntentProviderSchema,
      'playlist_intent',
      1_200,
    );
  }

  public async generateEditorialPlans(input: {
    catalogue: MusicCatalogueSummary;
    profile: MusicEditorialListenerProfile;
    locale: 'tr' | 'en';
    editionDate: string;
  }): Promise<unknown> {
    return this.generateStructured(
      buildMusicAiEditorialPrompt(input),
      musicEditorialPlansProviderSchema,
      'music_editorial_plans',
      4_000,
    );
  }

  private async generateStructured(
    prompt: string,
    schema: z.ZodType,
    schemaName: string,
    maxCompletionTokens: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(
        `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.options.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: schemaName,
                strict: true,
                schema: z.toJSONSchema(schema, { target: 'draft-07' }),
              },
            },
            reasoning_effort: 'none',
            include_reasoning: false,
            temperature: 0.2,
            max_completion_tokens: maxCompletionTokens,
          }),
        },
      );
      if (!response.ok) {
        if (response.status === 429)
          throw new MusicAiProviderError('rate-limited', response.status);
        throw new MusicAiProviderError('upstream', response.status);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new MusicAiProviderError('malformed-response');
      }
      const parsed = completionResponseSchema.safeParse(payload);
      if (!parsed.success) throw new MusicAiProviderError('malformed-response');
      try {
        return JSON.parse(parsed.data.choices[0]!.message.content) as unknown;
      } catch {
        throw new MusicAiProviderError('malformed-response');
      }
    } catch (error) {
      if (error instanceof MusicAiProviderError) throw error;
      if (controller.signal.aborted) throw new MusicAiProviderError('timeout');
      throw new MusicAiProviderError('upstream');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const createMusicAiProvider = (config: EnvConfig): MusicAiProvider | null => {
  if (!config.MUSIC_AI_API_KEY) return null;
  return new OpenAiCompatibleMusicProvider({
    apiKey: config.MUSIC_AI_API_KEY,
    model: config.MUSIC_AI_MODEL,
    baseUrl: config.MUSIC_AI_BASE_URL,
    timeoutMs: config.MUSIC_AI_TIMEOUT_MS,
  });
};
