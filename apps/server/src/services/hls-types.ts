import type { Readable } from 'node:stream';

/** Shapes shared by HlsService and its collaborators. */

export type HlsServiceOptions = {
  cacheRoot?: string;
  maxCacheBytes?: number;
  maxActiveJobs?: number;
};

/** A local path, a stream, or a URL FFmpeg should pull from. */
export type HlsInput =
  | string
  | Readable
  | {
      url: string;
      inputOptions?: string[];
    };

export type HlsProfile = 'video-copy-aac' | 'h264-aac';

export type HlsJobInfo = {
  id: string;
  cacheKey: string;
  mediaName: string;
  pid: number | null;
  startSeconds: number;
  startedAt: string;
  lastAccessAt: string;
  viewerCount: number;
  profile: HlsProfile;
  bufferLeadSeconds: number;
  isPaused: boolean;
};

export type HlsQueueInfo = {
  id: string;
  mediaName: string;
  startSeconds: number;
  priority: 'seek' | 'normal';
  queuedAt: string;
  waitMs: number;
};

export type HlsCacheStats = {
  activeJobs: number;
  queuedJobs: number;
  cacheBytes: number;
  cacheEntries: number;
  maxCacheBytes: number;
  maxActiveJobs: number;
  jobs: HlsJobInfo[];
  queue: HlsQueueInfo[];
};
