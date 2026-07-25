import type { SubtitleCue } from '../utils/subtitleCues';

export interface SubtitleTrackType {
  id: string;
  language: string;
  label: string;
  isForced?: boolean;
  isHearingImpaired?: boolean;
  isDefault?: boolean;
  url?: string;
  src?: string;
  cues?: SubtitleCue[];
}

export type PlayerErrorCode =
  | 'UNAUTHORIZED'
  | 'ACCESS_DENIED'
  | 'FILE_NOT_FOUND'
  | 'RANGE_INVALID'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CODEC_NOT_SUPPORTED'
  | 'NETWORK_DISCONNECTED'
  | 'STREAM_FAILED';

export interface PlayerErrorState {
  code: PlayerErrorCode;
  message: string;
  isRetryable: boolean;
}
