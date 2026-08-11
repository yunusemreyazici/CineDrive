import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

type FingerprintOutput = { duration: number; fingerprint: string };
type AcoustIdMatch = {
  id: string;
  score: number;
  title?: string;
  artist?: string;
  musicbrainzRecordingId?: string;
};

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const runFpcalc = (binary: string, filePath: string) =>
  new Promise<FingerprintOutput>((resolve, reject) => {
    execFile(
      binary,
      ['-json', filePath],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const parsed = JSON.parse(stdout) as Partial<FingerprintOutput>;
          if (!parsed.fingerprint || !Number.isFinite(parsed.duration))
            return reject(new Error('INVALID_FINGERPRINT_OUTPUT'));
          resolve({ fingerprint: parsed.fingerprint, duration: Number(parsed.duration) });
        } catch {
          reject(new Error('INVALID_FINGERPRINT_OUTPUT'));
        }
      },
    );
  });

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class MusicFingerprintService {
  private readonly binary = env.FPCALC_PATH || 'fpcalc';
  private lastLookupAt = 0;

  constructor(private readonly prisma: PrismaClient) {}

  public async capability() {
    const available = await new Promise<boolean>((resolve) => {
      execFile(this.binary, ['-version'], { timeout: 5000 }, (error) => resolve(!error));
    });
    return { available, acoustidConfigured: Boolean(env.ACOUSTID_API_KEY) };
  }

  public async scan(
    userId: string,
    input: { trackIds: string[]; force?: boolean },
    remoteSource?: (file: {
      googleDriveFileId: string | null;
      googleConnectionId: string | null;
      library: { googleConnectionId: string | null } | null;
    }) => string | null,
  ) {
    const capability = await this.capability();
    if (!capability.available)
      return { ...capability, analyzed: [], identified: [], skipped: input.trackIds.map((trackId) => ({ trackId, reason: 'FPCALC_UNAVAILABLE' })) };

    const tracks = await this.prisma.musicTrack.findMany({
      where: {
        id: { in: input.trackIds },
        library: { userId },
        driveFile: { status: 'active' },
      },
      include: {
        primaryArtist: true,
        fingerprint: true,
        driveFile: { include: { library: { select: { googleConnectionId: true } } } },
      },
    });
    const analyzed: string[] = [];
    const identified: string[] = [];
    const skipped: Array<{ trackId: string; reason: string }> = [];

    for (const track of tracks) {
      const sourcePath = track.driveFile.localFilePath || remoteSource?.(track.driveFile);
      if (!sourcePath) {
        skipped.push({ trackId: track.id, reason: 'REMOTE_SOURCE' });
        continue;
      }
      const unchanged =
        !input.force &&
        track.fingerprint?.status === 'analyzed' &&
        track.fingerprint.sourceModifiedAt?.getTime() === track.driveFile.modifiedTime?.getTime();
      if (unchanged) {
        skipped.push({ trackId: track.id, reason: 'UNCHANGED' });
        continue;
      }

      try {
        const result = await runFpcalc(this.binary, sourcePath);
        const hash = createHash('sha256').update(result.fingerprint).digest('hex');
        const match = capability.acoustidConfigured
          ? await this.lookup(result.fingerprint, result.duration)
          : null;
        await this.prisma.musicFingerprint.upsert({
          where: { trackId: track.id },
          create: {
            trackId: track.id,
            fingerprint: result.fingerprint,
            fingerprintHash: hash,
            duration: result.duration,
            sourceModifiedAt: track.driveFile.modifiedTime,
            acoustidId: match?.id,
            acoustidScore: match?.score,
            matchedTitle: match?.title,
            matchedArtist: match?.artist,
            musicbrainzRecordingId: match?.musicbrainzRecordingId,
            status: 'analyzed',
            analyzedAt: new Date(),
          },
          update: {
            fingerprint: result.fingerprint,
            fingerprintHash: hash,
            duration: result.duration,
            sourceModifiedAt: track.driveFile.modifiedTime,
            acoustidId: match?.id || null,
            acoustidScore: match?.score || null,
            matchedTitle: match?.title || null,
            matchedArtist: match?.artist || null,
            musicbrainzRecordingId: match?.musicbrainzRecordingId || null,
            status: 'analyzed',
            errorCode: null,
            analyzedAt: new Date(),
          },
        });
        analyzed.push(track.id);
        if (match) {
          identified.push(track.id);
          await this.createMetadataSuggestion(userId, track, match);
        }
      } catch (error) {
        const errorCode = error instanceof Error && error.message === 'INVALID_FINGERPRINT_OUTPUT'
          ? error.message
          : 'FINGERPRINT_FAILED';
        await this.prisma.musicFingerprint.upsert({
          where: { trackId: track.id },
          create: { trackId: track.id, status: 'failed', errorCode, analyzedAt: new Date() },
          update: { status: 'failed', errorCode, analyzedAt: new Date() },
        });
        skipped.push({ trackId: track.id, reason: errorCode });
      }
    }
    return { ...capability, analyzed, identified, skipped };
  }

  private async lookup(fingerprint: string, duration: number): Promise<AcoustIdMatch | null> {
    if (!env.ACOUSTID_API_KEY) return null;
    const elapsed = Date.now() - this.lastLookupAt;
    if (elapsed < 350) await wait(350 - elapsed);
    this.lastLookupAt = Date.now();
    const body = new URLSearchParams({
      client: env.ACOUSTID_API_KEY,
      duration: String(Math.round(duration)),
      fingerprint,
      meta: 'recordings+recordingids+compress',
      format: 'json',
    });
    const response = await fetch('https://api.acoustid.org/v2/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'CineDrive/1.0 (music fingerprint identification)' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{
        id: string;
        score: number;
        recordings?: Array<{ id?: string; title?: string; artists?: Array<{ name?: string }> }>;
      }>;
    };
    const result = payload.results?.sort((a, b) => b.score - a.score)[0];
    if (!result || result.score < 0.9) return null;
    const recording = result.recordings?.[0];
    return {
      id: result.id,
      score: result.score,
      title: recording?.title,
      artist: recording?.artists?.map((artist) => artist.name).filter(Boolean).join(', '),
      musicbrainzRecordingId: recording?.id,
    };
  }

  private async createMetadataSuggestion(
    userId: string,
    track: { id: string; title: string; musicbrainzRecordingId: string | null; primaryArtistId: string | null; primaryArtist: { name: string } | null },
    match: AcoustIdMatch,
  ) {
    const titleChanged = Boolean(match.title && normalize(match.title) !== normalize(track.title));
    const artistChanged = Boolean(match.artist && normalize(match.artist) !== normalize(track.primaryArtist?.name || ''));
    const recordingChanged = Boolean(match.musicbrainzRecordingId && match.musicbrainzRecordingId !== track.musicbrainzRecordingId);
    if (!titleChanged && !artistChanged && !recordingChanged) return;
    const existing = await this.prisma.musicMaintenanceSuggestion.findFirst({
      where: { userId, targetType: 'track', targetId: track.id, kind: 'acoustic-metadata', status: 'pending' },
    });
    if (existing) return;
    await this.prisma.musicMaintenanceSuggestion.create({
      data: {
        userId,
        targetType: 'track',
        targetId: track.id,
        kind: 'acoustic-metadata',
        provider: 'acoustid',
        confidence: Math.round(match.score * 100),
        currentData: JSON.stringify({
          title: track.title,
          primaryArtistId: track.primaryArtistId,
          artist: track.primaryArtist?.name || null,
          musicbrainzRecordingId: track.musicbrainzRecordingId,
        }),
        proposedData: JSON.stringify({
          title: match.title || track.title,
          artist: match.artist || track.primaryArtist?.name || null,
          musicbrainzRecordingId: match.musicbrainzRecordingId || track.musicbrainzRecordingId,
          acoustidId: match.id,
        }),
      },
    });
  }
}
