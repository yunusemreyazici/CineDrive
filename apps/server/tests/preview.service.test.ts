import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PreviewService, quantizePreviewTime } from '../src/services/preview.service';

const execFileAsync = promisify(execFile);
let tempDirectory = '';
let videoPath = '';

describe('PreviewService', () => {
  beforeAll(async () => {
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_AVAILABLE');
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-preview-test-'));
    videoPath = path.join(tempDirectory, 'sample.mp4');
    await execFileAsync(ffmpegPath, [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      videoPath,
    ]);
  });

  afterAll(async () => {
    if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it('groups hover positions into ten-second cache buckets', () => {
    expect(quantizePreviewTime(0)).toBe(0);
    expect(quantizePreviewTime(19.9)).toBe(10);
    expect(quantizePreviewTime(-4)).toBe(0);
  });

  it('generates a WebP frame for a local media file', async () => {
    const service = new PreviewService();
    const frame = await service.getFrame({
      driveFileId: 'preview-test-video',
      localFilePath: videoPath,
      timeSeconds: 0,
    });

    expect(frame.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(frame.includes(Buffer.from('WEBP'))).toBe(true);
  });
});
