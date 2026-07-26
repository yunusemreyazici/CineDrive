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
  '1080p': { bitrate: '3M', maxrate: '4M', bufsize: '8M', height: 1080 },
  // The library contains many SD/720-wide TV encodes around 0.7–1.2 Mbps.
  // Re-encoding those at 3 Mbps nearly tripled network use without improving
  // the source image. These profiles leave enough headroom for ultrafast x264
  // while keeping the compatibility stream close to its source traffic.
  '720p': { bitrate: '1400k', maxrate: '2M', bufsize: '4M', height: 720 },
  '480p': { bitrate: '900k', maxrate: '1200k', bufsize: '2400k', height: 480 },
};

export class TranscodeService {
  private readonly activeSessions = new Set<string>();
  private readonly ownerSessions = new Map<string, { id: string; kill: () => void }>();
  private readonly maxActiveSessions: number;

  constructor() {
    const configuredLimit = Number(process.env.TRANSCODE_MAX_ACTIVE_SESSIONS);
    this.maxActiveSessions =
      Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : 2;
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
    input: Readable | string,
    options: {
      transcodeVideo?: boolean;
      quality?: TranscodeQuality;
      startSeconds?: number;
      ownerSessionId?: string;
    } = {},
    onAbort?: (killFn: () => void) => void,
  ): { stream: Readable; kill: () => void } {
    const ownerSessionId = options.ownerSessionId;
    if (ownerSessionId && !/^[a-zA-Z0-9_-]{8,128}$/.test(ownerSessionId)) {
      throw new Error('INVALID_TRANSCODE_SESSION');
    }

    // A player tab owns at most one fragmented-MP4 FFmpeg process. Replace
    // the previous process before checking capacity so rapid seeks and source
    // changes cannot strand encoders or reject their own replacement.
    ownerSessionId && this.ownerSessions.get(ownerSessionId)?.kill();

    if (this.activeSessions.size >= this.maxActiveSessions) {
      throw new Error('TRANSCODE_CAPACITY_REACHED');
    }

    const sessionId = randomUUID();
    this.activeSessions.add(sessionId);
    const outputStream = new PassThrough();
    const quality = options.quality || '1080p';
    const profile = QUALITY_PROFILES[quality];
    const scaleOptions = profile.height ? ['-vf', `scale=-2:min(${profile.height}\\,ih)`] : [];
    const videoOptions = options.transcodeVideo
      ? [
          // VideoToolbox can accept the command and emit an MP4 header before
          // failing with kVTVideoEncoderMalfunctionErr (-12908). That leaves
          // browsers with a ready-looking, zero-duration stream. libx264's
          // low-latency profile is deterministic and remains comfortably
          // faster than real time for the compatibility resolutions.
          '-c:v libx264',
          '-preset ultrafast',
          '-tune zerolatency',
          '-b:v',
          profile.bitrate,
          '-maxrate',
          profile.maxrate,
          '-bufsize',
          profile.bufsize,
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
      if (ownerSessionId && this.ownerSessions.get(ownerSessionId)?.id === sessionId) {
        this.ownerSessions.delete(ownerSessionId);
      }
    };

    const inputOptions = [
      ...(options.startSeconds && options.startSeconds > 0
        ? ['-ss', options.startSeconds.toString()]
        : []),
      // Keep a modest lead over playback so Safari's buffer grows instead of
      // draining on small encode/load spikes. This remains tightly bounded,
      // unlike an unrestricted pipe that consumed hundreds of MB per second.
      '-readrate',
      '1.25',
      // Some MKV files start audio and video on slightly different clocks.
      // Generate a clean monotonic timeline before fragmented MP4 muxing.
      '-fflags',
      '+genpts',
      '-probesize',
      '65536',
      '-analyzeduration',
      '0',
    ];

    const command = ffmpeg(input)
      .inputOptions(inputOptions)
      .outputOptions([
        ...videoOptions,
        '-c:a aac',
        '-b:a 128k',
        '-ac 2',
        '-af',
        'aresample=async=1:first_pts=0',
        '-avoid_negative_ts',
        'make_zero',
        '-f mp4',
        '-movflags frag_keyframe+empty_moov+default_base_moof',
      ])
      .on('error', (err: Error) => {
        closeSession();
        if (
          !err.message.includes('Output stream closed') &&
          !err.message.includes('Output pipe closed') &&
          !err.message.includes('SIGKILL')
        ) {
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

    if (ownerSessionId) {
      this.ownerSessions.set(ownerSessionId, { id: sessionId, kill });
    }
    command.pipe(outputStream, { end: true });

    return { stream: outputStream, kill };
  }

  public releaseOwner(ownerSessionId: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(ownerSessionId)) {
      throw new Error('INVALID_TRANSCODE_SESSION');
    }
    const owned = this.ownerSessions.get(ownerSessionId);
    if (!owned) return false;
    owned.kill();
    return true;
  }

  public shutdown() {
    for (const owned of [...this.ownerSessions.values()]) {
      owned.kill();
    }
    this.ownerSessions.clear();
    this.activeSessions.clear();
  }
}
