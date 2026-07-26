import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { ownedLibraryFilter } from '../../utils/library-access.js';

/**
 * Pieces shared by the media transport routes (preview, stream and HLS), which
 * used to sit as closures at the top of a single 838-line route file.
 */

// FFmpeg reads its Drive input over HTTP. Reconnecting keeps a long encode
// alive across transient upstream resets instead of failing the whole job.
export const FFMPEG_HTTP_INPUT_OPTIONS = [
  '-reconnect',
  '1',
  '-reconnect_streamed',
  '1',
  '-reconnect_delay_max',
  '5',
  '-rw_timeout',
  '15000000',
];

/** Seek offsets beyond this are treated as malformed rather than clamped. */
const MAX_HLS_START_SECONDS = 7 * 24 * 60 * 60;

export const parseHlsStart = (value: unknown) => {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const startSeconds = Math.floor(Number(value));
  return Number.isSafeInteger(startSeconds) &&
    startSeconds >= 0 &&
    startSeconds <= MAX_HLS_START_SECONDS
    ? startSeconds
    : null;
};

export const parseHlsSession = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;

/**
 * A cache entry is only valid for the exact bytes it was produced from, so the
 * key folds in size, mtime and checksum: a replaced Drive file gets a new key
 * instead of serving the previous file's segments.
 */
export const hlsCacheKey = (
  driveFile: {
    id: string;
    size: bigint | null;
    modifiedTime: Date | null;
    md5Checksum: string | null;
  },
  startSeconds = 0,
) => {
  const fingerprint = createHash('sha256')
    .update(
      [
        driveFile.size?.toString() || '',
        driveFile.modifiedTime?.toISOString() || '',
        driveFile.md5Checksum || '',
      ].join(':'),
    )
    .digest('hex')
    .slice(0, 12);
  return `${driveFile.id}-${fingerprint}${startSeconds > 0 ? `-at-${startSeconds}` : ''}`;
};

/** Viewer-initiated endings, not failures worth reporting as errors. */
const CLIENT_ABANDONED_HLS_ERRORS = new Set([
  'HLS_CLIENT_ABORTED',
  'HLS_CLIENT_RELEASED',
  'HLS_REQUEST_SUPERSEDED',
]);

export const isClientAbandonedHlsError = (error: unknown) =>
  error instanceof Error && CLIENT_ABANDONED_HLS_ERRORS.has(error.message);

/**
 * A Drive file ID alone is not an authorization decision. Every lookup is
 * scoped to a library the caller actually owns.
 */
export const resolveActiveDriveFile = (
  fastify: FastifyInstance,
  driveFileId: string,
  userId: string,
) =>
  fastify.prisma.driveFile.findFirst({
    where: {
      OR: [
        { googleDriveFileId: driveFileId },
        { id: driveFileId },
        { localFilePath: driveFileId },
      ],
      status: 'active',
      library: ownedLibraryFilter(userId),
    },
    include: { library: true },
  });

export type ResolvedDriveFile = NonNullable<
  Awaited<ReturnType<typeof resolveActiveDriveFile>>
>;

/**
 * FFmpeg is pointed at this server rather than at googleapis.com so each
 * (re)connection resolves a fresh access token. See DriveSourceService.
 */
export const driveSourceInput = (
  fastify: FastifyInstance,
  driveFile: {
    googleDriveFileId: string | null;
    library: { googleConnectionId: string | null } | null;
  },
  userId: string,
) => {
  const capability = fastify.driveSourceService.issue({
    googleDriveFileId: driveFile.googleDriveFileId || '',
    userId,
    ...(driveFile.library?.googleConnectionId
      ? { connectionId: driveFile.library.googleConnectionId }
      : {}),
  });
  return {
    url: `http://127.0.0.1:${env.PORT}/api/internal/drive-source/${capability}`,
    inputOptions: [...FFMPEG_HTTP_INPUT_OPTIONS],
  };
};

export const fileNotFoundReply = (requestId: string) => ({
  error: {
    code: 'FILE_NOT_FOUND',
    message: 'Medya dosyası bulunamadı.',
    requestId,
  },
});
