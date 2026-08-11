import path from 'node:path';

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.m4v',
  '.avi',
  '.mov',
  '.ts',
  '.m2ts',
  '.flv',
  '.wmv',
  '.3gp',
]);

export const isVideoFilename = (filename: string): boolean =>
  VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());

/**
 * Drive MIME metadata is useful for extensionless files, but must not override
 * an explicit non-video extension. This prevents PDFs, EPUBs and other
 * documents with incorrect provider MIME metadata from becoming movies.
 */
export const isDriveVideoFile = (filename: string, mimeType: string): boolean => {
  const extension = path.extname(filename).toLowerCase();
  if (extension) return VIDEO_EXTENSIONS.has(extension);
  return mimeType.toLowerCase().startsWith('video/');
};
