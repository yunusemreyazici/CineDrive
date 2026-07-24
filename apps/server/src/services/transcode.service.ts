import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

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
    options: { transcodeVideo?: boolean } = {},
    onAbort?: (killFn: () => void) => void,
  ): { stream: Readable; kill: () => void } {
    if (this.activeSessions.size >= this.maxActiveSessions) {
      throw new Error('TRANSCODE_CAPACITY_REACHED');
    }

    const sessionId = randomUUID();
    this.activeSessions.add(sessionId);
    const outputStream = new PassThrough();
    const videoOptions = options.transcodeVideo
      ? process.platform === 'darwin'
        ? [
            '-c:v h264_videotoolbox',
            '-b:v 5M',
            '-maxrate 6M',
            '-bufsize 12M',
            '-profile:v high',
            '-level:v 4.1',
            '-pix_fmt yuv420p',
            '-g 50',
          ]
        : [
            '-c:v libx264',
            '-preset veryfast',
            '-crf 23',
            '-pix_fmt yuv420p',
            '-g 50',
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
