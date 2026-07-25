import { createHash } from 'node:crypto';
import { execFile, type ExecFileException } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const PREVIEW_INTERVAL_SECONDS = 10;
const PREVIEW_WIDTH = 240;
const PREVIEW_TIMEOUT_MS = 25_000;
const CACHE_DIR = path.resolve(process.cwd(), 'data', 'preview_cache');

export const quantizePreviewTime = (seconds: number) =>
  Math.max(0, Math.floor(seconds / PREVIEW_INTERVAL_SECONDS) * PREVIEW_INTERVAL_SECONDS);

interface PreviewSource {
  driveFileId: string;
  localFilePath?: string | null;
  googleDriveFileId?: string | null;
  modifiedTime?: Date | null;
  md5Checksum?: string | null;
  timeSeconds: number;
  googleAccessToken?: string;
}

export class PreviewService {
  private activeJob: Promise<Buffer> | null = null;
  private pendingByKey = new Map<string, Promise<Buffer>>();

  constructor() {
    void fs.mkdir(CACHE_DIR, { recursive: true });
  }

  public async getFrame(source: PreviewSource): Promise<Buffer> {
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_AVAILABLE');

    const timeSeconds = quantizePreviewTime(source.timeSeconds);
    const fingerprint = createHash('sha256')
      .update(
        [
          source.driveFileId,
          source.modifiedTime?.toISOString() || '',
          source.md5Checksum || '',
          timeSeconds,
          'webp-v1',
        ].join(':'),
      )
      .digest('hex');
    const outputPath = path.join(CACHE_DIR, `${fingerprint}.webp`);

    try {
      const cached = await fs.readFile(outputPath);
      if (cached.length > 0) return cached;
    } catch {
      // Cache miss.
    }

    const pending = this.pendingByKey.get(fingerprint);
    if (pending) return pending;
    if (this.activeJob) throw new Error('PREVIEW_CAPACITY_REACHED');

    const job = this.generateFrame(source, timeSeconds, outputPath);
    this.activeJob = job;
    this.pendingByKey.set(fingerprint, job);

    try {
      return await job;
    } finally {
      this.pendingByKey.delete(fingerprint);
      if (this.activeJob === job) this.activeJob = null;
    }
  }

  private async generateFrame(
    source: PreviewSource,
    timeSeconds: number,
    outputPath: string,
  ): Promise<Buffer> {
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_AVAILABLE');
    const binaryPath = ffmpegPath;
    const remoteUrl = source.googleDriveFileId
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(source.googleDriveFileId)}?alt=media&supportsAllDrives=true`
      : null;
    const input = source.localFilePath || remoteUrl;
    if (!input) throw new Error('PREVIEW_SOURCE_NOT_FOUND');
    if (remoteUrl && !source.googleAccessToken) throw new Error('GOOGLE_AUTH_REQUIRED');

    await fs.mkdir(CACHE_DIR, { recursive: true });
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(remoteUrl
        ? ['-headers', `Authorization: Bearer ${source.googleAccessToken}\r\n`]
        : []),
      '-ss',
      String(timeSeconds),
      '-i',
      input,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-vf',
      `scale=${PREVIEW_WIDTH}:-2:flags=lanczos`,
      '-c:v',
      'libwebp',
      '-quality',
      '68',
      '-y',
      outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      execFile(
        binaryPath,
        args,
        { timeout: PREVIEW_TIMEOUT_MS, maxBuffer: 512 * 1024, encoding: 'utf8' },
        (error: ExecFileException | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );
    });

    const frame = await fs.readFile(outputPath);
    if (frame.length === 0) throw new Error('PREVIEW_GENERATION_FAILED');
    return frame;
  }
}
