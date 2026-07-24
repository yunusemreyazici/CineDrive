import { describe, it, expect, vi } from 'vitest';
import { GoogleDriveService } from '../src/services/drive.service';

describe('GoogleDriveService Unit Tests', () => {
  const driveService = new GoogleDriveService();

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
});
