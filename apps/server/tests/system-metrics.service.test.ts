import { describe, expect, it } from 'vitest';
import type { SystemMetricSample } from '../src/generated/prisma/client.js';
import {
  aggregateMetricHistory,
  calculateCpuPercent,
  parseCgroupIo,
  parseDefaultNetworkInterface,
  parseNetworkCounters,
} from '../src/services/system-metrics.service.js';

const metricSample = (
  recordedAt: string,
  overrides: Partial<SystemMetricSample> = {},
): SystemMetricSample => ({
  id: 1,
  recordedAt: new Date(recordedAt),
  scope: 'container',
  cpuPercent: 25,
  memoryUsedBytes: 100n,
  memoryTotalBytes: 400n,
  diskUsedBytes: 500n,
  diskTotalBytes: 1_000n,
  diskReadBytesPerSecond: 10,
  diskWriteBytesPerSecond: 20,
  diskReadBytesTotal: 1_000n,
  diskWriteBytesTotal: 2_000n,
  networkReceiveBytesPerSecond: 30,
  networkTransmitBytesPerSecond: 40,
  networkReceiveBytesDelta: 300n,
  networkTransmitBytesDelta: 400n,
  networkReceiveBytesTotal: 3_000n,
  networkTransmitBytesTotal: 4_000n,
  networkInterface: 'eth0',
  temperatureCelsius: 45,
  ...overrides,
});

describe('system metrics parsing', () => {
  it('sums cgroup v2 IO counters from every device', () => {
    expect(
      parseCgroupIo('8:0 rbytes=100 wbytes=200 rios=1 wios=2\n8:16 rbytes=300 wbytes=400'),
    ).toEqual({ read: 400n, write: 600n });
  });

  it('uses the default network interface without double-counting bridges', () => {
    const route =
      'Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 00000000 0100000A 0003 0 0 0 00000000';
    const devices = [
      'Inter-| Receive | Transmit',
      ' face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed',
      'lo: 10 0 0 0 0 0 0 0 10 0 0 0 0 0 0 0',
      'eth0: 1200 0 0 0 0 0 0 0 3400 0 0 0 0 0 0 0',
      'docker0: 5000 0 0 0 0 0 0 0 6000 0 0 0 0 0 0 0',
    ].join('\n');
    const defaultInterface = parseDefaultNetworkInterface(route);
    expect(defaultInterface).toBe('eth0');
    expect(parseNetworkCounters(devices, defaultInterface)).toEqual({
      received: 1200n,
      transmitted: 3400n,
    });
  });

  it('calculates bounded cgroup CPU utilization against the effective quota', () => {
    expect(
      calculateCpuPercent(
        { kind: 'cgroup', usedMicroseconds: 3_000_000, capacityCores: 2 },
        { kind: 'cgroup', usedMicroseconds: 2_000_000, capacityCores: 2 },
        2,
      ),
    ).toBe(25);
    expect(
      calculateCpuPercent(
        { kind: 'cgroup', usedMicroseconds: 10_000_000, capacityCores: 1 },
        { kind: 'cgroup', usedMicroseconds: 0, capacityCores: 1 },
        1,
      ),
    ).toBe(100);
    expect(
      calculateCpuPercent(
        { kind: 'cgroup', usedMicroseconds: 100, capacityCores: 1 },
        { kind: 'cgroup', usedMicroseconds: 1_000, capacityCores: 1 },
        1,
      ),
    ).toBe(0);
  });
});

describe('system metric history', () => {
  it('downsamples into five-minute buckets while retaining exact bandwidth totals', () => {
    const history = aggregateMetricHistory([
      metricSample('2026-09-04T10:01:00.000Z'),
      metricSample('2026-09-04T10:04:00.000Z', {
        id: 2,
        cpuPercent: 75,
        networkReceiveBytesDelta: 700n,
        networkTransmitBytesDelta: 600n,
      }),
      metricSample('2026-09-04T10:06:00.000Z', { id: 3 }),
    ]);

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      recordedAt: '2026-09-04T10:00:00.000Z',
      cpuPercent: 50,
      networkReceiveBytes: 1_000,
      networkTransmitBytes: 1_000,
    });
    expect(history[1]?.recordedAt).toBe('2026-09-04T10:05:00.000Z');
  });
});
