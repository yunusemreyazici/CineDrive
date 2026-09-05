import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { TranscodeService } from '../src/services/transcode.service';

describe('TranscodeService', () => {
  it('emits an audio-only fragmented MP4 media fragment before the live input ends', async () => {
    const input = new PassThrough();
    const service = new TranscodeService();
    const { stream, kill } = service.createTranscodedStream(input, {
      audioOnly: true,
      realtime: false,
      inputOptions: ['-f', 's16le', '-ar', '48000', '-ac', '2'],
    });

    const chunks: Buffer[] = [];
    const fragment = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for a fragmented MP4 media box')),
        5_000,
      );
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const output = Buffer.concat(chunks);
        if (!output.includes(Buffer.from('moof'))) return;
        clearTimeout(timeout);
        resolve(output);
      });
      stream.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Three seconds of stereo 48 kHz signed 16-bit PCM. Deliberately keep the
    // stream open: the regression emitted media only after end-of-input.
    input.write(Buffer.alloc(48_000 * 2 * 2 * 3));

    try {
      const output = await fragment;
      expect(output.includes(Buffer.from('ftyp'))).toBe(true);
      expect(output.includes(Buffer.from('moof'))).toBe(true);
      expect(output.includes(Buffer.from('mdat'))).toBe(true);
    } finally {
      kill();
      input.destroy();
    }
  });
});
