import { describe, expect, it } from 'vitest';
import { MAX_STREAM_CHUNK_BYTES, resolveRangeRequest } from '../src/utils/http-range';

const FILE_SIZE = 10_485_760;

describe('resolveRangeRequest', () => {
  it('reports an absent Range header', () => {
    expect(resolveRangeRequest(undefined, FILE_SIZE)).toEqual({ kind: 'none' });
  });

  it('rejects multi-range and malformed headers', () => {
    expect(resolveRangeRequest('bytes=0-1,5-6', FILE_SIZE).kind).toBe('multi');
    expect(resolveRangeRequest('bytes=invalid-range', FILE_SIZE).kind).toBe('invalid');
    expect(resolveRangeRequest('bytes=-', FILE_SIZE).kind).toBe('invalid');
  });

  it('passes an explicit in-bounds window through unchanged', () => {
    expect(resolveRangeRequest('bytes=0-1023', FILE_SIZE)).toEqual({
      kind: 'range',
      start: 0,
      end: 1023,
      header: 'bytes=0-1023',
    });
  });

  it('bounds an open-ended range to one chunk and clamps it to the last byte', () => {
    expect(resolveRangeRequest('bytes=1048576-', FILE_SIZE)).toMatchObject({
      header: 'bytes=1048576-9437183',
    });
    expect(resolveRangeRequest('bytes=10485000-', FILE_SIZE)).toMatchObject({
      end: FILE_SIZE - 1,
    });
  });

  it('reports a start position past the end of the file as unsatisfiable', () => {
    // Previously `end` was clamped while `start` was not, producing a negative
    // Content-Length alongside a 206 response.
    expect(resolveRangeRequest('bytes=99999999-', FILE_SIZE)).toEqual({
      kind: 'unsatisfiable',
      size: FILE_SIZE,
    });
    expect(resolveRangeRequest(`bytes=${FILE_SIZE}-`, FILE_SIZE).kind).toBe('unsatisfiable');
    expect(resolveRangeRequest('bytes=500-100', FILE_SIZE).kind).toBe('unsatisfiable');
  });

  it('resolves a suffix range to the final bytes rather than the first ones', () => {
    expect(resolveRangeRequest('bytes=-500', FILE_SIZE)).toEqual({
      kind: 'range',
      start: FILE_SIZE - 500,
      end: FILE_SIZE - 1,
      header: `bytes=${FILE_SIZE - 500}-${FILE_SIZE - 1}`,
    });
  });

  it('starts a suffix range longer than the file at byte zero', () => {
    expect(resolveRangeRequest('bytes=-99999999', FILE_SIZE)).toMatchObject({
      start: 0,
      end: FILE_SIZE - 1,
    });
  });

  it('defers a suffix range to the upstream when the size is unknown', () => {
    expect(resolveRangeRequest('bytes=-500', null)).toEqual({
      kind: 'passthrough',
      header: 'bytes=-500',
    });
  });

  it('narrows an oversized explicit range instead of forwarding a whole-file request', () => {
    const resolution = resolveRangeRequest('bytes=0-99999999999', FILE_SIZE);
    expect(resolution).toMatchObject({ start: 0, end: MAX_STREAM_CHUNK_BYTES - 1 });
  });

  it('still bounds the window when the resource size is unknown', () => {
    expect(resolveRangeRequest('bytes=0-', null)).toEqual({
      kind: 'range',
      start: 0,
      end: MAX_STREAM_CHUNK_BYTES - 1,
      header: `bytes=0-${MAX_STREAM_CHUNK_BYTES - 1}`,
    });
  });
});
