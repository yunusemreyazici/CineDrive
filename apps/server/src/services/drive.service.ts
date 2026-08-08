import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { decodeSubtitleBytes } from '../utils/subtitle-encoding.js';
import { buffer } from 'node:stream/consumers';

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  parents?: string[];
  videoMediaMetadata?: drive_v3.Schema$File['videoMediaMetadata'];
}

export class GoogleDriveService {
  private createDriveClient(accessToken: string): drive_v3.Drive {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Exponential backoff wrapper for retrying transient Google Drive API errors
   */
  public async withExponentialBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 4,
    initialDelayMs = process.env.NODE_ENV === 'test' ? 10 : 500,
  ): Promise<T> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (err: unknown) {
        attempt++;
        const isRateLimitOrServerErr =
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err.code === 429 || (typeof err.code === 'number' && err.code >= 500));

        if (!isRateLimitOrServerErr || attempt >= maxRetries) {
          throw err;
        }

        const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('MAX_RETRIES_EXCEEDED');
  }

  /**
   * Lists ALL files in the entire Google Drive account (including Shared Drives) without folder restrictions
   */
  public async listAccountFiles(
    accessToken: string,
    pageToken?: string,
  ): Promise<{ files: DriveFileMetadata[]; nextPageToken?: string }> {
    return this.withExponentialBackoff(async () => {
      const drive = this.createDriveClient(accessToken);

      const response = await drive.files.list({
        q: "trashed = false and (mimeType contains 'video/' or mimeType contains 'audio/' or mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.folder' or name contains '.mp4' or name contains '.mkv' or name contains '.webm' or name contains '.avi' or name contains '.mov' or name contains '.ts' or name contains '.m2ts' or name contains '.flv' or name contains '.wmv' or name contains '.3gp' or name contains '.mp3' or name contains '.m4a' or name contains '.aac' or name contains '.flac' or name contains '.ogg' or name contains '.opus' or name contains '.wav' or name contains '.wma' or name contains '.srt' or name contains '.vtt')",
        fields:
          'nextPageToken, files(id, name, mimeType, size, modifiedTime, md5Checksum, parents, videoMediaMetadata)',
        pageSize: 1000,
        pageToken,
        corpora: 'allDrives',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = (response.data.files || []).map((file) => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        size: file.size || undefined,
        modifiedTime: file.modifiedTime || undefined,
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        videoMediaMetadata: file.videoMediaMetadata || undefined,
      }));

      return {
        files: files.filter((f) => !!f.id),
        nextPageToken: response.data.nextPageToken || undefined,
      };
    });
  }

  /**
   * Lists files in a specific Google Drive parent folder with fields restriction and pagination
   */
  public async listFolderContents(
    accessToken: string,
    folderId: string,
    pageToken?: string,
  ): Promise<{ files: DriveFileMetadata[]; nextPageToken?: string }> {
    return this.withExponentialBackoff(async () => {
      const drive = this.createDriveClient(accessToken);

      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          'nextPageToken, files(id, name, mimeType, size, modifiedTime, md5Checksum, parents, videoMediaMetadata)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = (response.data.files || []).map((file) => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        size: file.size || undefined,
        modifiedTime: file.modifiedTime || undefined,
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        videoMediaMetadata: file.videoMediaMetadata || undefined,
      }));

      return {
        files: files.filter((f) => !!f.id),
        nextPageToken: response.data.nextPageToken || undefined,
      };
    });
  }

  /**
   * Fetches text content of a file (e.g. metadata.json or SRT/VTT subtitles)
   */
  public async getFileTextContent(accessToken: string, fileId: string): Promise<string> {
    return this.withExponentialBackoff(async () => {
      const drive = this.createDriveClient(accessToken);
      const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );
      if (typeof response.data === 'string') return response.data;
      return decodeSubtitleBytes(Buffer.from(response.data as ArrayBuffer));
    });
  }

  /**
   * Creates a pass-through Readable stream directly from Google Drive API for video Range streaming.
   * Supports AbortSignal for immediate disconnection on client close.
   */
  public async createMediaStream(
    accessToken: string,
    fileId: string,
    rangeHeader?: string,
    signal?: AbortSignal,
  ): Promise<{
    stream: Readable;
    status: number;
    headers: Record<string, string>;
  }> {
    const drive = this.createDriveClient(accessToken);
    const headers: Record<string, string> = {};
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    const response = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      {
        headers,
        responseType: 'stream',
        signal,
      },
    );

    const resHeaders: Record<string, string> = {};
    if (response.headers['content-type']) resHeaders['content-type'] = String(response.headers['content-type']);
    if (response.headers['content-length']) resHeaders['content-length'] = String(response.headers['content-length']);
    if (response.headers['content-range']) resHeaders['content-range'] = String(response.headers['content-range']);
    if (response.headers['accept-ranges']) resHeaders['accept-ranges'] = String(response.headers['accept-ranges']);
    if (response.headers['etag']) resHeaders['etag'] = String(response.headers['etag']);
    if (response.headers['last-modified']) resHeaders['last-modified'] = String(response.headers['last-modified']);

      return {
        stream: response.data as Readable,
        status: response.status,
        headers: resHeaders,
      };
    }

  /**
   * Downloads a strictly bounded byte range for media header analysis.
   * Refuses an upstream 200 response so a provider regression can never turn
   * a small probe into an accidental full-file download.
   */
  public async getMediaRangeBuffer(
    accessToken: string,
    fileId: string,
    start: number,
    end: number,
  ): Promise<Buffer> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw new Error('INVALID_MEDIA_RANGE');
    }

    const expectedLength = end - start + 1;
    const response = await this.createMediaStream(
      accessToken,
      fileId,
      `bytes=${start}-${end}`,
    );

    if (response.status !== 206) {
      response.stream.destroy();
      throw new Error('DRIVE_RANGE_NOT_SUPPORTED');
    }

    const contentLength = Number(response.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > expectedLength) {
      response.stream.destroy();
      throw new Error('DRIVE_RANGE_EXCEEDED');
    }

    const content = await buffer(response.stream);
    if (content.length > expectedLength) {
      throw new Error('DRIVE_RANGE_EXCEEDED');
    }
    return content;
  }

  /**
   * Lists all Shared Drives (Team Drives) accessible by the user
   */
  public async listSharedDrives(
    accessToken: string
  ): Promise<Array<{ id: string; name: string }>> {
    return this.withExponentialBackoff(async () => {
      const drive = this.createDriveClient(accessToken);
      const response = await drive.drives.list({
        pageSize: 100,
        fields: 'drives(id, name)',
      });

      return (response.data.drives || [])
        .map((d) => ({
          id: d.id || '',
          name: d.name || '',
        }))
        .filter((d) => !!d.id);
    });
  }
}
