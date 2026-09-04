import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { SystemMetricsDto } from '@cinedrive/shared';
import { apiClient } from '../api/client';
import { SystemMetricsPanel } from '../pages/SystemMetricsPanel';
import { buildDailyBandwidth } from '../utils/systemMetrics';
import { renderWithProviders } from './helpers/renderWithProviders';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const response: SystemMetricsDto = {
  scope: 'container',
  sampleIntervalSeconds: 60,
  retentionDays: 7,
  current: {
    recordedAt: '2026-09-04T12:00:00.000Z',
    cpuPercent: 25,
    memoryUsedBytes: 2 * 1024 ** 3,
    memoryTotalBytes: 4 * 1024 ** 3,
    diskUsedBytes: 50 * 1024 ** 3,
    diskTotalBytes: 100 * 1024 ** 3,
    diskReadBytesPerSecond: 1024,
    diskWriteBytesPerSecond: 2048,
    networkReceiveBytesPerSecond: 4096,
    networkTransmitBytesPerSecond: 8192,
    networkReceiveBytes: 10_000,
    networkTransmitBytes: 20_000,
    temperatureCelsius: null,
  },
  history: [],
  sevenDayBandwidth: { receivedBytes: 10_000, transmittedBytes: 20_000, totalBytes: 30_000 },
};

describe('system metrics panel', () => {
  it('renders current resources and a seven-day bandwidth chart', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: response });
    renderWithProviders(<SystemMetricsPanel />);

    await waitFor(() => expect(screen.getByText('Sistem Kaynakları')).toBeInTheDocument());
    expect(screen.getAllByText('%25')).toHaveLength(2);
    expect(screen.getByText('2 GiB')).toBeInTheDocument();
    expect(screen.getByText('Desteklenmiyor')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Son yedi günün ağ trafiği grafiği' }),
    ).toBeInTheDocument();
  });

  it('keeps daily receive and transmit totals when building the graph', () => {
    const history = [
      { ...response.current!, recordedAt: '2026-09-03T10:00:00.000Z' },
      {
        ...response.current!,
        recordedAt: '2026-09-03T10:05:00.000Z',
        networkReceiveBytes: 5_000,
        networkTransmitBytes: 7_000,
      },
    ];
    const days = buildDailyBandwidth(history, new Date('2026-09-04T12:00:00.000Z'));
    expect(days).toHaveLength(7);
    expect(days.find((day) => day.receivedBytes === 15_000)).toMatchObject({
      transmittedBytes: 27_000,
    });
  });
});
