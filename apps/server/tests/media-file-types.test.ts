import { describe, expect, it } from 'vitest';
import { isDriveVideoFile, isVideoFilename } from '../src/services/media-file-types';

describe('media file type classification', () => {
  it('accepts supported video filenames', () => {
    expect(isVideoFilename('Movie.2026.mkv')).toBe(true);
    expect(isDriveVideoFile('Movie.2026.mp4', 'application/octet-stream')).toBe(true);
  });

  it('rejects PDF and EPUB documents even when Drive reports a video MIME type', () => {
    expect(isDriveVideoFile('Book.pdf', 'video/mp4')).toBe(false);
    expect(isDriveVideoFile('Novel.epub', 'video/webm')).toBe(false);
  });

  it('allows genuinely extensionless Drive videos', () => {
    expect(isDriveVideoFile('Camera upload', 'video/mp4')).toBe(true);
  });
});
