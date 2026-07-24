import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import ffmpegPath from 'ffmpeg-static';

export interface MediaTechnicalMetadata {
  mediaContainer: string;
  videoCodec?: string;
  videoProfile?: string;
  videoBitDepth?: number;
  audioCodec?: string;
  audioChannels?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDuration?: number;
  mediaAnalyzedAt: Date;
  mediaAnalysisError: null;
}

const PROBE_TIMEOUT_MS = 15_000;
const REMOTE_HEAD_BYTES = 8 * 1024 * 1024;
const REMOTE_TAIL_BYTES = 4 * 1024 * 1024;

export class MediaProbeService {
  public async probeLocalFile(inputPath: string): Promise<MediaTechnicalMetadata> {
    const stderr = await this.runProbe(inputPath);
    return this.parseProbeOutput(stderr, inputPath);
  }

  public async probeRemoteFile(options: {
    name: string;
    size: bigint;
    readRange: (start: number, end: number) => Promise<Buffer>;
  }): Promise<MediaTechnicalMetadata> {
    if (options.size <= 0n || options.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('INVALID_REMOTE_MEDIA_SIZE');
    }

    const size = Number(options.size);
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'cinedrive-probe-'));
    const extension = path.extname(options.name).toLowerCase();
    const tempPath = path.join(tempDirectory, `media${extension}`);

    try {
      const file = await open(tempPath, 'w');
      try {
        await file.truncate(size);
        const headEnd = Math.min(size, REMOTE_HEAD_BYTES) - 1;
        const head = await options.readRange(0, headEnd);
        await file.write(head, 0, head.length, 0);

        if (size > REMOTE_HEAD_BYTES) {
          const tailStart = Math.max(REMOTE_HEAD_BYTES, size - REMOTE_TAIL_BYTES);
          const tail = await options.readRange(tailStart, size - 1);
          await file.write(tail, 0, tail.length, tailStart);
        }
      } finally {
        await file.close();
      }

      const stderr = await this.runProbe(tempPath);
      return this.parseProbeOutput(stderr, options.name);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private async runProbe(inputPath: string): Promise<string> {
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_AVAILABLE');
    const binaryPath = ffmpegPath;

    return new Promise<string>((resolve, reject) => {
      execFile(
        binaryPath,
        [
          '-hide_banner',
          '-i',
          inputPath,
          '-map',
          '0:v:0?',
          '-map',
          '0:a:0?',
          '-t',
          '0',
          '-f',
          'null',
          '-',
        ],
        { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, _stdout, output) => {
          // FFmpeg may exit non-zero after probing malformed media; its stderr
          // is still useful as long as stream metadata was emitted.
          if (error && !output.includes('Stream #')) {
            reject(error);
            return;
          }
          resolve(output);
        },
      );
    });
  }

  private parseProbeOutput(stderr: string, inputPath: string): MediaTechnicalMetadata {
    const durationMatch = stderr.match(
      /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/,
    );
    const videoLine = stderr.match(/Stream #\S+.*Video:\s*([^\r\n]+)/)?.[1];
    const audioLine = stderr.match(/Stream #\S+.*Audio:\s*([^\r\n]+)/)?.[1];
    if (!videoLine) {
      throw new Error('MEDIA_VIDEO_STREAM_NOT_DETECTED');
    }
    const dimensions = videoLine?.match(/,\s*(\d{2,5})x(\d{2,5})(?:[,\s]|$)/);
    const pixelFormat = videoLine?.match(/,\s*(yuv[a-z0-9]+)/i)?.[1];
    const bitDepth = pixelFormat?.match(/p(\d{2})(?:le|be)?$/i)?.[1];
    const channelsText = audioLine?.match(
      /,\s*(mono|stereo|[2-9]\.\d(?:\([^)]+\))?)(?:,|$)/i,
    )?.[1];

    return {
      mediaContainer: path.extname(inputPath).slice(1).toLowerCase(),
      videoCodec: videoLine?.match(/^([^,\s]+)/)?.[1]?.toLowerCase(),
      videoProfile: videoLine?.match(/^[^,]*\(([^)]+)\)/)?.[1]?.trim(),
      videoBitDepth: bitDepth ? Number.parseInt(bitDepth, 10) : 8,
      audioCodec: audioLine?.match(/^([^,\s]+)/)?.[1]?.toLowerCase(),
      audioChannels: this.parseChannels(channelsText),
      mediaWidth: dimensions ? Number.parseInt(dimensions[1]!, 10) : undefined,
      mediaHeight: dimensions ? Number.parseInt(dimensions[2]!, 10) : undefined,
      mediaDuration: durationMatch
        ? Number(durationMatch[1]) * 3600 +
          Number(durationMatch[2]) * 60 +
          Number(durationMatch[3])
        : undefined,
      mediaAnalyzedAt: new Date(),
      mediaAnalysisError: null,
    };
  }

  private parseChannels(value?: string) {
    if (!value) return undefined;
    if (value.toLowerCase() === 'mono') return 1;
    if (value.toLowerCase() === 'stereo') return 2;
    const surround = value.match(/^(\d)\.(\d)/);
    return surround
      ? Number.parseInt(surround[1]!, 10) + Number.parseInt(surround[2]!, 10)
      : undefined;
  }
}
