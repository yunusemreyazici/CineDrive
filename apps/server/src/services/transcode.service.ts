import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export type TranscodeQuality = 'original' | '1080p' | '720p' | '480p';

const QUALITY_PROFILES: Record<
  TranscodeQuality,
  { bitrate: string; maxrate: string; bufsize: string; height?: number }
> = {
  original: { bitrate: '7M', maxrate: '8M', bufsize: '16M' },
  '1080p': { bitrate: '5M', maxrate: '6M', bufsize: '12M', height: 1080 },
  '720p': { bitrate: '3M', maxrate: '4M', bufsize: '8M', height: 720 },
  '480p': { bitrate: '1500k', maxrate: '2M', bufsize: '4M', height: 480 },
};

export class TranscodeService {
  private readonly activeSessions = new Set<string>();
  private readonly maxActiveSessions: number;

  constructor() {
    const configuredLimit = Number(process.env.TRANSCODE_MAX_ACTIVE_SESSIONS);
    this.maxActiveSessions =
      Number.isFinite(configuredLimit) && configuredLimit > 0
        ? Math.floor(configuredLimit)
        : 2;
  }

  public getStats() {
    return {
      activeSessions: this.activeSessions.size,
      maxActiveSessions: this.maxActiveSessions,
    };
  }

  /**
   * Creates a live audio-transcoded stream with instant startup.
   * -probesize 65536 & -analyzeduration 0 prevent FFmpeg from downloading hundreds of MBs just to probe headers.
   * Video track is copied as-is (-c:v copy) for 0% CPU video overhead.
   * Incompatible surround audio (AC3/EAC3/DTS) is converted to stereo AAC (-c:a aac -ac 2).
   */
  public createTranscodedStream(
    inputStream: Readable,
    options: {
      transcodeVideo?: boolean;
      quality?: TranscodeQuality;
    } = {},
    onAbort?: (killFn: () => void) => void,
  ): { stream: Readable; kill: () => void } {
    if (this.activeSessions.size >= this.maxActiveSessions) {
      throw new Error('TRANSCODE_CAPACITY_REACHED');
    }

    const sessionId = randomUUID();
    this.activeSessions.add(sessionId);
    const outputStream = new PassThrough();
    const quality = options.quality || '1080p';
    const profile = QUALITY_PROFILES[quality];
    const scaleOptions = profile.height
      ? ['-vf', `scale=-2:min(${profile.height}\\,ih)`]
      : [];
    const videoOptions = options.transcodeVideo
      ? process.platform === 'darwin'
        ? [
            '-c:v h264_videotoolbox',
            '-b:v', profile.bitrate,
            '-maxrate', profile.maxrate,
            '-bufsize', profile.bufsize,
            '-profile:v high',
            '-level:v 4.1',
            '-pix_fmt yuv420p',
            '-g 50',
            ...scaleOptions,
          ]
        : [
            '-c:v libx264',
            '-preset veryfast',
            '-b:v', profile.bitrate,
            '-maxrate', profile.maxrate,
            '-bufsize', profile.bufsize,
            '-pix_fmt yuv420p',
            '-g 50',
            ...scaleOptions,
          ]
      : ['-c:v copy'];

    let closed = false;
    const closeSession = () => {
      if (closed) return;
      closed = true;
      this.activeSessions.delete(sessionId);
    };

    const command = ffmpeg(inputStream)
      .inputOptions([
        // Keep a modest lead over playback so Safari's buffer grows instead of
        // draining on small encode/load spikes. This remains tightly bounded,
        // unlike an unrestricted pipe that consumed hundreds of MB per second.
        '-readrate', '1.25',
        '-probesize', '65536',
        '-analyzeduration', '0',
      ])
      .outputOptions([
        ...videoOptions,
        '-c:a aac',
        '-b:a 192k',
        '-ac 2',
        '-f mp4',
        '-movflags frag_keyframe+empty_moov+default_base_moof',
      ])
      .on('error', (err: Error) => {
        closeSession();
        if (!err.message.includes('Output stream closed') && !err.message.includes('Output pipe closed') && !err.message.includes('SIGKILL')) {
          console.error('[TranscodeService] FFmpeg streaming error:', err.message);
        }
        outputStream.destroy(err);
      })
      .on('end', closeSession);

    const kill = () => {
      closeSession();
      try {
        command.kill('SIGKILL');
      } catch {
        // ignore kill errors
      }
    };

    if (onAbort) {
      onAbort(kill);
    }

    command.pipe(outputStream, { end: true });

    return { stream: outputStream, kill };
  }
}
