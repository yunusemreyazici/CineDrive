import { z } from 'zod';
import type { MusicPlaylistDto } from '../types/index.js';

const id = z.string().min(1).max(200);
const unique = (values: string[]) => new Set(values).size === values.length;
const operationId = z.string().uuid().optional();
export const refineMusicMixSchema = z
  .object({
    mixId: z.string().min(1).max(200),
    keepIds: z.array(id).max(100).refine(unique),
    generationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();
export const recordingFamilySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    trackIds: z.array(id).min(2).max(30).refine(unique),
    preferredTrackId: id,
  })
  .strict()
  .refine((v) => v.trackIds.includes(v.preferredTrackId));
export const listeningCheckpointSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    trackIds: z.array(id).min(1).max(500),
    index: z.number().int().min(0).max(499),
    position: z.number().min(0).max(86400),
    savedAt: z.iso.datetime(),
  })
  .strict()
  .refine((v) => v.index < v.trackIds.length);
export const musicStudioSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    families: z.array(recordingFamilySchema).max(200),
    sessions: z.array(listeningCheckpointSchema).max(30),
  })
  .strict()
  .refine(
    (v) =>
      unique(v.families.map((f) => f.id)) &&
      unique(v.sessions.map((s) => s.id)) &&
      unique(v.families.flatMap((f) => f.trackIds)),
  );
export type MusicStudioDto = z.infer<typeof musicStudioSchema>;
export const playlistWorkshopSchema = z
  .object({
    operationId,
    version: z.string().regex(/^[a-f0-9]{64}$/),
    // Keep occurrence IDs stable, including when undo restores a removed occurrence.
    items: z.array(z.object({ id: z.string().uuid(), trackId: id }).strict()).max(2000),
  })
  .strict()
  .refine((v) => unique(v.items.map((i) => i.id)));
export const playlistTransferSchema = z
  .object({
    operationId,
    version: z.string().regex(/^[a-f0-9]{64}$/),
    targetId: id,
    targetVersion: z.string().regex(/^[a-f0-9]{64}$/),
    itemIds: z.array(z.string().uuid()).min(1).max(500).refine(unique),
    move: z.boolean(),
  })
  .strict();
export const playlistInvitationSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(['editor', 'listener']),
  })
  .strict();

export const studioCreatePlaylistSchema = z
  .object({
    operationId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export const studioRestoreSchema = z
  .object({
    operationId: z.string().uuid(),
    version: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const studioPageSchema = z
  .object({
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const studioChangeQuerySchema = z
  .object({
    cursor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export interface StudioPlaylistSummaryDto {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'listener';
  pending: boolean;
}
export interface StudioPlaylistDirectoryDto {
  playlists: StudioPlaylistSummaryDto[];
  nextCursor: string | null;
}
export interface StudioChangesDto {
  cursor: number;
  hasMore: boolean;
  resetRequired: boolean;
  changes: Array<{ id: number; playlistId: string; kind: string }>;
}
export interface StudioHistoryDto {
  entries: Array<{
    id: number;
    actorName: string | null;
    kind: string;
    createdAt: string;
    added: number;
    removed: number;
    canRestore: boolean;
  }>;
  nextCursor: string | null;
}
export interface StudioWorkshopDto {
  version: string;
  role: 'owner' | 'editor' | 'listener';
  canEdit: boolean;
  unavailableCount: number;
  playlist: MusicPlaylistDto;
  members: Array<{ userId: string; name: string; role: string; accepted: boolean }>;
}
export interface StudioTrackLabelDto {
  id: string;
  title: string;
  primaryArtist: { name: string } | null;
  album: { title: string } | null;
}
/** Local aggregate counts only. Missing-evidence counts overlap and do not promise matches. */
export interface MusicAiPlaylistCoverageDto {
  catalogueCount: number;
  hardMatchedCount: number;
  versionEligibleCount: number;
  missingLanguageEvidence: number;
  missingYear: number;
  missingGenres: number;
}
export interface StudioRevisionItemsDto {
  items: Array<{
    occurrenceId: string;
    kind: 'added' | 'removed';
    track: StudioTrackLabelDto | null;
  }>;
  nextCursor: string | null;
}
export interface StudioWorkerDto {
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  nextRunAt: string | null;
  failures: number;
  estimatedRemainingSeconds: null;
}
export interface StudioHealthDto {
  quality: {
    total: number;
    unknownLanguage: number;
    missingYear: number;
    missingGenres: number;
    lyricsAvailable: number;
    lyricsMissing: number;
    lyricsIndexed: number;
    indexPending: number;
  };
  scans: Array<{
    id: string;
    status: string;
    libraryName: string;
    addedCount: number;
    updatedCount: number;
    deletedCount: number;
    errorCount: number;
    startedAt: string;
    completedAt: string | null;
    heartbeatAt: string | null;
    estimatedRemainingSeconds: null;
  }>;
  enrichment: {
    queued: number;
    processing: number;
    completed: number;
    notFound: number;
    failed: number;
    retryWaiting: number;
    providerLookups: number;
    providerHttp429: number;
    providerHttp5xx: number;
    lastJobStartedAt: string | null;
    lastJobCompletedAt: string | null;
    job: { status: 'running' | 'idle' };
  };
  workers: Record<string, StudioWorkerDto> | null;
}
