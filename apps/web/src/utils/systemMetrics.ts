import type { SystemMetricPointDto } from '@cinedrive/shared';
import { locale } from '../i18n';

export interface DailyBandwidth {
  key: string;
  label: string;
  receivedBytes: number;
  transmittedBytes: number;
}

export const buildDailyBandwidth = (
  history: SystemMetricPointDto[],
  now = new Date(),
): DailyBandwidth[] => {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return { key, label: formatter.format(date), receivedBytes: 0, transmittedBytes: 0 };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));
  for (const point of history) {
    const date = new Date(point.recordedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const day = byKey.get(key);
    if (!day) continue;
    day.receivedBytes += point.networkReceiveBytes;
    day.transmittedBytes += point.networkTransmitBytes;
  }
  return days;
};
