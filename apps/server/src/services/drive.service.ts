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
    initialDelayMs = 500,
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
   * Fetches a media file stream from Google Drive for Range requests proxy
   */
  public async getFileStream(
    accessToken: string,
    fileId: string,
    rangeHeader?: string,
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
      },
    );

    const resHeaders: Record<string, string> = {};
    if (response.headers['content-type']) resHeaders['content-type'] = response.headers['content-type'];
    if (response.headers['content-length']) resHeaders['content-length'] = response.headers['content-length'];
    if (response.headers['content-range']) resHeaders['content-range'] = response.headers['content-range'];
    if (response.headers['accept-ranges']) resHeaders['accept-ranges'] = response.headers['accept-ranges'];

    return {
      stream: response.data as Readable,
      status: response.status,
      headers: resHeaders,
    };
  }
}
