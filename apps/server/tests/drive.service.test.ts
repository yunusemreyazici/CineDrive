import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { GoogleDriveService, normalizeDriveResponseHeaders } from '../src/services/drive.service';

describe('GoogleDriveService Unit Tests', () => {
  const driveService = new GoogleDriveService();

  it('forwards media headers from the WHATWG Headers returned by Gaxios 7', () => {
    const headers = new Headers({
      'content-type': 'audio/flac',
      'content-length': '1024',
      'content-range': 'bytes 0-1023/4096',
      'accept-ranges': 'bytes',
      etag: 'fixture-etag',
      'last-modified': 'Sat, 05 Sep 2026 00:00:00 GMT',
      'x-google-internal': 'must-not-leak',
    });

    expect(normalizeDriveResponseHeaders(headers)).toEqual({
      'content-type': 'audio/flac',
      'content-length': '1024',
      'content-range': 'bytes 0-1023/4096',
      'accept-ranges': 'bytes',
      etag: 'fixture-etag',
      'last-modified': 'Sat, 05 Sep 2026 00:00:00 GMT',
    });
  });

  it('should return result immediately if function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await driveService.withExponentialBackoff(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry transient 429 rate limit error and succeed on subsequent attempt', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('Rate limit') as Error & { code: number };
        err.code = 429;
        throw err;
      }
      return 'recovered';
    });

    const result = await driveService.withExponentialBackoff(fn, 3, 10);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should rethrow non-transient 404 error immediately without retrying', async () => {
    const fn = vi.fn().mockImplementation(async () => {
      const err = new Error('Not found') as Error & { code: number };
      err.code = 404;
      throw err;
    });

    await expect(driveService.withExponentialBackoff(fn, 3, 10)).rejects.toThrow('Not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('downloads only the requested media range', async () => {
    const createMediaStream = vi.spyOn(driveService, 'createMediaStream').mockResolvedValue({
      stream: Readable.from(Buffer.from('header')),
      status: 206,
      headers: {
        'content-length': '6',
        'content-range': 'bytes 0-5/1000',
      },
    });

    await expect(driveService.getMediaRangeBuffer('token', 'file', 0, 5)).resolves.toEqual(
      Buffer.from('header'),
    );
    expect(createMediaStream).toHaveBeenCalledWith(
      'token',
      'file',
      'bytes=0-5',
      expect.any(AbortSignal),
    );
  });

  it('refuses a full-file response to a bounded media probe', async () => {
    const stream = Readable.from(Buffer.alloc(1024));
    const destroy = vi.spyOn(stream, 'destroy');
    vi.spyOn(driveService, 'createMediaStream').mockResolvedValue({
      stream,
      status: 200,
      headers: { 'content-length': '1024' },
    });

    await expect(driveService.getMediaRangeBuffer('token', 'file', 0, 5)).rejects.toThrow(
      'DRIVE_RANGE_NOT_SUPPORTED',
    );
    expect(destroy).toHaveBeenCalled();
  });
});
