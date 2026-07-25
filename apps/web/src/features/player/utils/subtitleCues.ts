export interface SubtitleCue {
  startTime: number;
  endTime: number;
  text: string;
}

const parseTimestamp = (value: string) => {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) return null;

  const hours = parts.length === 3 ? parts[0] : 0;
  const minutes = parts.length === 3 ? parts[1] : parts[0];
  const seconds = parts.length === 3 ? parts[2] : parts[1];
  if (hours === undefined || minutes === undefined || seconds === undefined) return null;
  return hours * 3600 + minutes * 60 + seconds;
};

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

export const parseWebVttCues = (source: string): SubtitleCue[] => {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;

    const timingLine = lines[timingIndex];
    if (!timingLine) continue;
    const [rawStart, rawEndWithSettings] = timingLine.split('-->');
    if (!rawStart) continue;
    const rawEnd = rawEndWithSettings?.trim().split(/\s+/)[0];
    const startTime = parseTimestamp(rawStart);
    const endTime = rawEnd ? parseTimestamp(rawEnd) : null;
    if (startTime === null || endTime === null || endTime <= startTime) continue;

    const text = decodeEntities(
      lines
        .slice(timingIndex + 1)
        .join('\n')
        .replace(/<[^>]*>/g, ''),
    ).trim();
    if (text) cues.push({ startTime, endTime, text });
  }

  return cues.sort((a, b) => a.startTime - b.startTime);
};

export const findActiveSubtitleCue = (
  cues: SubtitleCue[],
  currentTime: number,
  delay = 0,
) => {
  const cueTime = currentTime - delay;
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle];
    if (!cue) return undefined;
    if (cueTime < cue.startTime) high = middle - 1;
    else if (cueTime > cue.endTime) low = middle + 1;
    else return cue;
  }

  return undefined;
};
