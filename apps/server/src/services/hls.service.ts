import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const READY_SEGMENT_COUNT = 3;
const WAIT_TIMEOUT_MS = 45_000;
const IDLE_JOB_TIMEOUT_MS = 45_000;
const CACHE_VERSION = 'stream-copy-v3';

type HlsJob = {
  command: FfmpegCommand;
  ready: Promise<void>;
  lastAccessAt: number;
  idleTimer: NodeJS.Timeout;
};

export class HlsService {
  private readonly cacheRoot = path.resolve(process.cwd(), 'data/hls_cache');
  private readonly jobs = new Map<string, HlsJob>();

  constructor() {
    fs.mkdirSync(this.cacheRoot, { recursive: true });
  }

  public getCacheDir(cacheKey: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(cacheKey)) throw new Error('INVALID_HLS_KEY');
    return path.join(this.cacheRoot, `${cacheKey}-${CACHE_VERSION}`);
  }

  public async ensureHls(
    cacheKey: string,
    inputFactory: () => Promise<string | Readable>,
  ) {
    const outputDir = this.getCacheDir(cacheKey);
    const playlistPath = path.join(outputDir, 'index.m3u8');

    let job = this.jobs.get(cacheKey);
    if (job) {
      job.lastAccessAt = Date.now();
      await job.ready;
      return playlistPath;
    }

    if (this.isComplete(playlistPath)) return playlistPath;

    // A previous viewer may have left while an EVENT playlist was still being
    // generated. Start clean instead of presenting a permanently truncated
    // playlist as if it were a complete episode.
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }

    if (!job) {
      const input = await inputFactory();

      // Resolving a remote source may take long enough for a concurrent
      // request to start this cache first. Discard the duplicate source.
      job = this.jobs.get(cacheKey);
      if (job) {
        if (typeof input !== 'string') input.destroy();
        await job.ready;
        return playlistPath;
      }

      fs.mkdirSync(outputDir, { recursive: true });
      const sourceCodecs =
        typeof input === 'string' ? this.probeLocalCodecs(input) : null;
      const canCopyVideo =
        sourceCodecs?.video === 'h264' || sourceCodecs?.video === 'hevc';
      const videoOptions = canCopyVideo
        ? [
            '-c:v copy',
            ...(sourceCodecs?.video === 'hevc' ? ['-tag:v hvc1'] : []),
          ]
        : [
            ...(process.platform === 'darwin'
              ? [
                  '-c:v h264_videotoolbox',
                  '-b:v 5M',
                  '-maxrate 6M',
                  '-bufsize 12M',
                  '-profile:v high',
                  '-level:v 4.1',
                  '-pix_fmt yuv420p',
                ]
              : ['-c:v libx264', '-preset veryfast', '-crf 23', '-pix_fmt yuv420p']),
            '-force_key_frames expr:gte(t,n_forced*4)',
          ];
      const command = ffmpeg(input)
        // Generate a modest buffer ahead of playback instead of racing through
        // a multi-GB source and duplicating the whole file immediately.
        .inputOptions(['-readrate 2'])
        .outputOptions([
          '-map 0:v:0',
          '-map 0:a:0?',
          '-sn',
          '-dn',
          ...videoOptions,
          '-c:a aac',
          '-b:a 192k',
          '-ac 2',
          '-f hls',
          '-hls_time 4',
          '-hls_list_size 0',
          '-hls_playlist_type event',
          '-hls_segment_type fmp4',
          '-hls_fmp4_init_filename init.mp4',
          '-hls_segment_filename',
          path.join(outputDir, 'segment-%06d.m4s'),
          '-hls_flags independent_segments+temp_file',
        ])
        .output(playlistPath);

      const ready = new Promise<void>((resolve, reject) => {
        let settled = false;
        let poll: NodeJS.Timeout | undefined;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          if (poll) clearInterval(poll);
          callback();
        };

        command
          .on('error', (error: Error) => {
            const failedJob = this.jobs.get(cacheKey);
            if (failedJob) clearInterval(failedJob.idleTimer);
            this.jobs.delete(cacheKey);
            finish(() => reject(error));
          })
          .on('end', () => {
            const completedJob = this.jobs.get(cacheKey);
            if (completedJob) clearInterval(completedJob.idleTimer);
            this.jobs.delete(cacheKey);
            finish(resolve);
          })
          .run();

        const startedAt = Date.now();
        poll = setInterval(() => {
          if (this.isReady(playlistPath)) {
            finish(resolve);
          } else if (Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
            finish(() => reject(new Error('HLS_PREPARATION_TIMEOUT')));
          }
        }, 250);
      });

      const idleTimer = setInterval(() => {
        const activeJob = this.jobs.get(cacheKey);
        if (
          activeJob &&
          Date.now() - activeJob.lastAccessAt >= IDLE_JOB_TIMEOUT_MS
        ) {
          activeJob.command.kill('SIGTERM');
        }
      }, 5_000);
      idleTimer.unref();

      job = { command, ready, lastAccessAt: Date.now(), idleTimer };
      this.jobs.set(cacheKey, job);
    }

    await job.ready;
    return playlistPath;
  }

  public resolveAsset(cacheKey: string, assetName: string) {
    if (!/^(index\.m3u8|init\.mp4|segment-\d{6}\.m4s)$/.test(assetName)) {
      throw new Error('INVALID_HLS_ASSET');
    }
    const job = this.jobs.get(cacheKey);
    if (job) job.lastAccessAt = Date.now();
    return path.join(this.getCacheDir(cacheKey), assetName);
  }

  public shutdown() {
    for (const job of this.jobs.values()) {
      clearInterval(job.idleTimer);
      try {
        job.command.kill('SIGKILL');
      } catch {
        // Process may already have exited.
      }
    }
    this.jobs.clear();
  }

  private isReady(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const playlist = fs.readFileSync(playlistPath, 'utf8');
    return (playlist.match(/#EXTINF:/g) || []).length >= READY_SEGMENT_COUNT;
  }

  private isComplete(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    return fs.readFileSync(playlistPath, 'utf8').includes('#EXT-X-ENDLIST');
  }

  private probeLocalCodecs(inputPath: string) {
    if (!ffmpegPath) return null;
    const result = spawnSync(
      ffmpegPath,
      ['-hide_banner', '-i', inputPath, '-t', '0', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const output = result.stderr || '';
    return {
      video: output.match(/Video:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
      audio: output.match(/Audio:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
    };
  }
}
