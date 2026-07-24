import path from 'node:path';
import { execFile } from 'node:child_process';
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

export class MediaProbeService {
  public async probeLocalFile(inputPath: string): Promise<MediaTechnicalMetadata> {
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_AVAILABLE');
    const binaryPath = ffmpegPath;

    const stderr = await new Promise<string>((resolve, reject) => {
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

    const durationMatch = stderr.match(
      /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/,
    );
    const videoLine = stderr.match(/Stream #\S+.*Video:\s*([^\r\n]+)/)?.[1];
    const audioLine = stderr.match(/Stream #\S+.*Audio:\s*([^\r\n]+)/)?.[1];
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
