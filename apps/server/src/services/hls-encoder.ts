import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg';
import type { HlsInput, HlsProfile } from './hls-types.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

/** Codec probes are advisory: if one hangs, carry on rather than hold playback. */
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_MAX_STDERR_BYTES = 1024 * 1024;

export interface LocalCodecs {
  video: string | undefined;
  audio: string | undefined;
}

/**
 * Reads the codecs FFmpeg reports for a local file.
 *
 * Asynchronous on purpose: as `spawnSync` this blocked the event loop, and with
 * it every other viewer's segment request, for as long as FFmpeg took to open
 * the file.
 */
export const probeLocalCodecs = (inputPath: string): Promise<LocalCodecs | null> => {
  if (!ffmpegPath) return Promise.resolve(null);
  const binary = ffmpegPath;

  return new Promise((resolve) => {
    const child = spawn(binary, ['-hide_banner', '-i', inputPath, '-t', '0', '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    let settled = false;
    const finish = (output: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        video: output.match(/Video:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
        audio: output.match(/Audio:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
      });
    };

    // An unknown codec simply routes through the deterministic H.264 path.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(stderr);
    }, PROBE_TIMEOUT_MS);

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < PROBE_MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', () => finish(''));
    child.on('close', () => finish(stderr));
  });
};

/**
 * Recent Safari versions decode many HEVC files directly, but some hvc1 sources
 * still fail once remuxed as fragmented HLS. H.264 stays zero-copy; everything
 * else is made deterministic for the Safari compatibility path. An accurate
 * seek also forces a re-encode, because copying starts at the preceding
 * keyframe rather than the requested timestamp.
 */
export const videoOptions = (videoCodec: string, accurateSeekRequired = false) => {
  if (videoCodec === 'h264' && !accurateSeekRequired) return ['-c:v copy'];
  return [
    '-c:v libx264',
    '-preset ultrafast',
    '-tune zerolatency',
    '-b:v 5M',
    '-maxrate 6M',
    '-bufsize 12M',
    '-profile:v high',
    '-level:v 4.1',
    '-pix_fmt yuv420p',
    '-force_key_frames expr:gte(t,n_forced*4)',
  ];
};

export const selectProfile = (videoCodec: string, accurateSeekRequired: boolean): HlsProfile =>
  videoCodec === 'h264' && !accurateSeekRequired ? 'video-copy-aac' : 'h264-aac';

interface BuildCommandOptions {
  input: HlsInput;
  outputDir: string;
  playlistPath: string;
  startSeconds: number;
  videoCodec: string;
}

/** Assembles the FFmpeg invocation that produces an EVENT fMP4 HLS stream. */
export const buildHlsCommand = ({
  input,
  outputDir,
  playlistPath,
  startSeconds,
  videoCodec,
}: BuildCommandOptions): FfmpegCommand => {
  const isRemoteUrlInput = typeof input === 'object' && 'url' in input;
  const inputSource = isRemoteUrlInput ? input.url : input;
  const accurateSeekRequired = startSeconds > 0;

  return ffmpeg(inputSource)
    // Generate a modest buffer ahead of playback instead of racing through a
    // multi-GB source and duplicating the whole file immediately.
    .inputOptions([
      ...(isRemoteUrlInput ? input.inputOptions || [] : []),
      ...(startSeconds > 0 ? ['-ss', String(startSeconds)] : []),
      '-readrate',
      // MKV sources often have 8–10 second keyframe intervals, so the first
      // complete copy-remuxed HLS segment otherwise arrives too late for mobile
      // WebKit. Burst at 4x for startup; the lead-based pause in the service
      // still caps background generation at 24 seconds.
      '4',
    ])
    .outputOptions([
      '-map 0:v:0',
      '-map 0:a:0?',
      '-sn',
      '-dn',
      ...videoOptions(videoCodec, accurateSeekRequired),
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
};

/**
 * Resolves the codec to plan around: the value recorded during library scanning
 * when available, otherwise whatever a probe of a local file reports.
 */
export const resolveVideoCodec = async (
  input: HlsInput,
  sourceVideoCodec: string | null | undefined,
): Promise<string> => {
  if (sourceVideoCodec) return sourceVideoCodec.toLowerCase();

  const isRemoteUrlInput = typeof input === 'object' && 'url' in input;
  if (typeof input !== 'string' || isRemoteUrlInput) return '';

  const probed = await probeLocalCodecs(input);
  return probed?.video || '';
};
