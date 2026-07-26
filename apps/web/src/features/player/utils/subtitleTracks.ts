import type { SubtitleTrackType } from '../types/player';
import type { SubtitleItemType } from '../../../types/media';
import type { SubtitleCue } from './subtitleCues';

/**
 * Subtitle plumbing shared by the player component and its hooks: shape
 * normalisation between the API and player representations, and the timeline
 * maths that keeps cues aligned when a transcoded stream restarts at zero.
 */

export const alignSubtitleCueToPlaybackTimeline = (
  startTime: number,
  endTime: number,
  timelineOffset: number,
  subtitleDelay: number,
) => {
  const alignedStart = Math.max(0, startTime - timelineOffset + subtitleDelay);
  return {
    startTime: alignedStart,
    endTime: Math.max(alignedStart + 0.001, endTime - timelineOffset + subtitleDelay),
  };
};

const formatWebVttTimestamp = (seconds: number) => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;
};

export const serializeSubtitleCuesToVtt = (cues: SubtitleCue[]) =>
  `WEBVTT\n\n${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatWebVttTimestamp(cue.startTime)} --> ${formatWebVttTimestamp(
          cue.endTime,
        )}\n${cue.text}`,
    )
    .join('\n\n')}\n`;

export const getNativeSubtitleSource = (subtitle: SubtitleTrackType) => {
  if (subtitle.url) return subtitle.url;
  if (subtitle.src) return subtitle.src;
  if (subtitle.cues?.length) {
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(
      serializeSubtitleCuesToVtt(subtitle.cues),
    )}`;
  }
  return `/api/media/${subtitle.id}/subtitle`;
};

export const normalizeSubtitleTrack = (
  subtitle: SubtitleItemType | SubtitleTrackType,
): SubtitleTrackType => {
  const apiSubtitle = subtitle as SubtitleItemType;
  const playerSubtitle = subtitle as SubtitleTrackType;
  const language = playerSubtitle.language || apiSubtitle.languageCode || 'und';

  return {
    id: subtitle.id,
    language,
    label:
      playerSubtitle.label ||
      apiSubtitle.languageLabel ||
      (language === 'und' ? 'Bilinmeyen Dil' : language.toUpperCase()),
    isForced: playerSubtitle.isForced ?? apiSubtitle.forced ?? false,
    isHearingImpaired: playerSubtitle.isHearingImpaired ?? apiSubtitle.hearingImpaired ?? false,
    isDefault: subtitle.isDefault ?? false,
    url: subtitle.url,
    src: playerSubtitle.src,
    cues: playerSubtitle.cues,
  };
};
