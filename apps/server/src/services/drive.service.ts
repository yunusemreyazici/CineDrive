import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'stream';

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
        q: "trashed = false and (mimeType contains 'video/' or mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.folder' or name contains '.mp4' or name contains '.mkv' or name contains '.webm' or name contains '.avi' or name contains '.mov' or name contains '.ts' or name contains '.m2ts' or name contains '.flv' or name contains '.wmv' or name contains '.3gp' or name contains '.srt' or name contains '.vtt')",
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
        pageSize: 100,
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
        { fileId, alt: 'media' },
        { responseType: 'text' },
      );
      return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
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
      { fileId, alt: 'media' },
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
