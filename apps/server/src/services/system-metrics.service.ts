import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient, SystemMetricSample } from '../generated/prisma/client.js';
import { toSqliteAdapterInput } from '../config/database-url.js';
import type { SystemMetricPointDto, SystemMetricsDto } from '@cinedrive/shared';

export const SYSTEM_METRICS_SAMPLE_INTERVAL_MS = 60_000;
export const SYSTEM_METRICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const SYSTEM_METRICS_BUCKET_MS = 5 * 60 * 1_000;

type CpuCounter =
  | { kind: 'cgroup'; usedMicroseconds: number; capacityCores: number }
  | { kind: 'host'; busyTicks: number; totalTicks: number };

export interface RawSystemMetrics {
  capturedAt: Date;
  scope: 'container' | 'host';
  cpu: CpuCounter | null;
  memoryUsedBytes: bigint | null;
  memoryTotalBytes: bigint | null;
  diskUsedBytes: bigint | null;
  diskTotalBytes: bigint | null;
  diskReadBytesTotal: bigint | null;
  diskWriteBytesTotal: bigint | null;
  networkReceiveBytesTotal: bigint | null;
  networkTransmitBytesTotal: bigint | null;
  networkInterface: string | null;
  temperatureCelsius: number | null;
}

type PersistedCounterBaseline = Pick<
  SystemMetricSample,
  | 'recordedAt'
  | 'scope'
  | 'diskReadBytesTotal'
  | 'diskWriteBytesTotal'
  | 'networkReceiveBytesTotal'
  | 'networkTransmitBytesTotal'
  | 'networkInterface'
>;

type MetricLogger = {
  error: (bindings: Record<string, unknown>, message: string) => void;
};

const readText = async (filePath: string): Promise<string | null> =>
  fs.readFile(filePath, 'utf8').catch(() => null);

const parseInteger = (value: string | undefined): bigint | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
};

export const parseCgroupIo = (contents: string): { read: bigint; write: bigint } => {
  let read = 0n;
  let write = 0n;
  for (const line of contents.trim().split('\n')) {
    for (const field of line.trim().split(/\s+/).slice(1)) {
      const [name, value] = field.split('=');
      const parsed = parseInteger(value);
      if (parsed === null) continue;
      if (name === 'rbytes') read += parsed;
      if (name === 'wbytes') write += parsed;
    }
  }
  return { read, write };
};

export const parseNetworkCounters = (
  contents: string,
  preferredInterface?: string | null,
): { received: bigint; transmitted: bigint } => {
  let received = 0n;
  let transmitted = 0n;
  const rows = contents
    .split('\n')
    .slice(2)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [interfaceName, counters = ''] = line.split(':', 2);
      return { interfaceName: interfaceName?.trim(), counters: counters.trim().split(/\s+/) };
    })
    .filter((row) => row.interfaceName && row.interfaceName !== 'lo');
  const selected = preferredInterface
    ? rows.filter((row) => row.interfaceName === preferredInterface)
    : rows;
  for (const row of selected.length > 0 ? selected : rows) {
    received += parseInteger(row.counters[0]) || 0n;
    transmitted += parseInteger(row.counters[8]) || 0n;
  }
  return { received, transmitted };
};

export const parseDefaultNetworkInterface = (contents: string): string | null => {
  for (const line of contents.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[1] === '00000000' && fields[0]) return fields[0];
  }
  return null;
};

const hostCpuCounter = (): CpuCounter => {
  let busyTicks = 0;
  let totalTicks = 0;
  for (const cpu of os.cpus()) {
    const values = Object.values(cpu.times);
    const total = values.reduce((sum, value) => sum + value, 0);
    totalTicks += total;
    busyTicks += total - cpu.times.idle;
  }
  return { kind: 'host', busyTicks, totalTicks };
};

const cgroupCpuCounter = async (): Promise<CpuCounter | null> => {
  const [stat, maximum] = await Promise.all([
    readText('/sys/fs/cgroup/cpu.stat'),
    readText('/sys/fs/cgroup/cpu.max'),
  ]);
  const match = stat?.match(/^usage_usec\s+(\d+)$/m);
  if (!match) return null;
  const [quota, period] = maximum?.trim().split(/\s+/) || [];
  const quotaValue = quota && quota !== 'max' ? Number(quota) : Number.NaN;
  const periodValue = Number(period);
  const quotaCores =
    Number.isFinite(quotaValue) && Number.isFinite(periodValue) && periodValue > 0
      ? quotaValue / periodValue
      : os.availableParallelism();
  return {
    kind: 'cgroup',
    usedMicroseconds: Number(match[1]),
    capacityCores: Math.max(0.01, Math.min(os.availableParallelism(), quotaCores)),
  };
};

const detectContainer = async (): Promise<boolean> => {
  const [dockerMarker, cgroup] = await Promise.all([
    fs.access('/.dockerenv').then(
      () => true,
      () => false,
    ),
    readText('/proc/1/cgroup'),
  ]);
  return dockerMarker || /(?:docker|containerd|kubepods|podman)/i.test(cgroup || '');
};

const readMemory = async (container: boolean) => {
  if (container) {
    const [current, maximum] = await Promise.all([
      readText('/sys/fs/cgroup/memory.current'),
      readText('/sys/fs/cgroup/memory.max'),
    ]);
    const used = parseInteger(current?.trim());
    const total = maximum?.trim() === 'max' ? null : parseInteger(maximum?.trim());
    if (used !== null && total !== null && total > 0n) {
      return { used, total };
    }
  }
  const total = BigInt(os.totalmem());
  return { used: total - BigInt(os.freemem()), total };
};

const readDiskUsage = async (databaseUrl: string) => {
  const configured = toSqliteAdapterInput(databaseUrl).url;
  const target = configured === ':memory:' ? process.cwd() : path.dirname(path.resolve(configured));
  const stats = await fs.statfs(target, { bigint: true }).catch(() => null);
  if (!stats) return { used: null, total: null };
  const total = stats.blocks * stats.bsize;
  const available = stats.bavail * stats.bsize;
  return { used: total - available, total };
};

const readDiskIo = async (container: boolean) => {
  if (container) {
    const ioStat = await readText('/sys/fs/cgroup/io.stat');
    if (ioStat) return parseCgroupIo(ioStat);
  }

  const [diskstats, blockDevices] = await Promise.all([
    readText('/proc/diskstats'),
    fs.readdir('/sys/block').catch(() => []),
  ]);
  if (!diskstats) return { read: null, write: null };
  const allowed = new Set(blockDevices);
  let read = 0n;
  let write = 0n;
  let found = false;
  for (const line of diskstats.trim().split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (!allowed.has(fields[2] || '')) continue;
    const sectorsRead = parseInteger(fields[5]);
    const sectorsWritten = parseInteger(fields[9]);
    if (sectorsRead === null || sectorsWritten === null) continue;
    read += sectorsRead * 512n;
    write += sectorsWritten * 512n;
    found = true;
  }
  return found ? { read, write } : { read: null, write: null };
};

const readNetwork = async () => {
  const [devices, route] = await Promise.all([
    readText('/proc/net/dev'),
    readText('/proc/net/route'),
  ]);
  if (!devices) return { received: null, transmitted: null, interfaceName: null };
  const interfaceName = route ? parseDefaultNetworkInterface(route) : null;
  return {
    ...parseNetworkCounters(devices, interfaceName),
    interfaceName: interfaceName || '*',
  };
};

const temperatureValue = (contents: string | null): number | null => {
  const value = Number(contents?.trim());
  if (!Number.isFinite(value)) return null;
  const celsius = Math.abs(value) >= 1_000 ? value / 1_000 : value;
  return celsius >= -20 && celsius <= 150 ? celsius : null;
};

const readTemperature = async (): Promise<number | null> => {
  const candidates: string[] = [];
  const thermalZones = await fs.readdir('/sys/class/thermal').catch(() => []);
  candidates.push(
    ...thermalZones
      .filter((entry) => entry.startsWith('thermal_zone'))
      .map((entry) => `/sys/class/thermal/${entry}/temp`),
  );
  const hardwareMonitors = await fs.readdir('/sys/class/hwmon').catch(() => []);
  for (const monitor of hardwareMonitors) {
    const root = `/sys/class/hwmon/${monitor}`;
    const entries = await fs.readdir(root).catch(() => []);
    candidates.push(
      ...entries
        .filter((entry) => /^temp\d+_input$/.test(entry))
        .map((entry) => `${root}/${entry}`),
    );
  }
  const values = (
    await Promise.all(candidates.slice(0, 64).map((candidate) => readText(candidate)))
  )
    .map(temperatureValue)
    .filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
};

export const collectRawSystemMetrics = async (databaseUrl: string): Promise<RawSystemMetrics> => {
  const container = await detectContainer();
  const [memory, disk, diskIo, network, temperature, cpu] = await Promise.all([
    readMemory(container),
    readDiskUsage(databaseUrl),
    readDiskIo(container),
    readNetwork(),
    readTemperature(),
    container ? cgroupCpuCounter() : Promise.resolve(hostCpuCounter()),
  ]);
  return {
    capturedAt: new Date(),
    scope: container ? 'container' : 'host',
    cpu: cpu || hostCpuCounter(),
    memoryUsedBytes: memory.used,
    memoryTotalBytes: memory.total,
    diskUsedBytes: disk.used,
    diskTotalBytes: disk.total,
    diskReadBytesTotal: diskIo.read,
    diskWriteBytesTotal: diskIo.write,
    networkReceiveBytesTotal: network.received,
    networkTransmitBytesTotal: network.transmitted,
    networkInterface: network.interfaceName,
    temperatureCelsius: temperature,
  };
};

const safeDelta = (current: bigint | null, previous: bigint | null): bigint =>
  current !== null && previous !== null && current >= previous ? current - previous : 0n;

export const calculateCpuPercent = (
  current: CpuCounter | null,
  previous: CpuCounter | null,
  elapsedSeconds: number,
): number | null => {
  if (!current || !previous || current.kind !== previous.kind || elapsedSeconds <= 0) return null;
  let percent: number;
  if (current.kind === 'cgroup' && previous.kind === 'cgroup') {
    const usedSeconds = (current.usedMicroseconds - previous.usedMicroseconds) / 1_000_000;
    percent = (usedSeconds / elapsedSeconds / current.capacityCores) * 100;
  } else if (current.kind === 'host' && previous.kind === 'host') {
    const total = current.totalTicks - previous.totalTicks;
    percent = total > 0 ? ((current.busyTicks - previous.busyTicks) / total) * 100 : 0;
  } else {
    return null;
  }
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
};

const toNumber = (value: bigint | null): number | null => (value === null ? null : Number(value));

const toPoint = (sample: SystemMetricSample): SystemMetricPointDto => ({
  recordedAt: sample.recordedAt.toISOString(),
  cpuPercent: sample.cpuPercent,
  memoryUsedBytes: toNumber(sample.memoryUsedBytes),
  memoryTotalBytes: toNumber(sample.memoryTotalBytes),
  diskUsedBytes: toNumber(sample.diskUsedBytes),
  diskTotalBytes: toNumber(sample.diskTotalBytes),
  diskReadBytesPerSecond: sample.diskReadBytesPerSecond,
  diskWriteBytesPerSecond: sample.diskWriteBytesPerSecond,
  networkReceiveBytesPerSecond: sample.networkReceiveBytesPerSecond,
  networkTransmitBytesPerSecond: sample.networkTransmitBytesPerSecond,
  networkReceiveBytes: Number(sample.networkReceiveBytesDelta),
  networkTransmitBytes: Number(sample.networkTransmitBytesDelta),
  temperatureCelsius: sample.temperatureCelsius,
});

const average = (values: Array<number | null>): number | null => {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;
};

export const aggregateMetricHistory = (
  samples: SystemMetricSample[],
  bucketMs = SYSTEM_METRICS_BUCKET_MS,
): SystemMetricPointDto[] => {
  const buckets = new Map<number, SystemMetricSample[]>();
  for (const sample of samples) {
    const bucket = Math.floor(sample.recordedAt.getTime() / bucketMs) * bucketMs;
    const entries = buckets.get(bucket) || [];
    entries.push(sample);
    buckets.set(bucket, entries);
  }
  return [...buckets.entries()].map(([bucket, entries]) => {
    const points = entries.map(toPoint);
    const latest = points.at(-1)!;
    return {
      recordedAt: new Date(bucket).toISOString(),
      cpuPercent: average(points.map((point) => point.cpuPercent)),
      memoryUsedBytes: average(points.map((point) => point.memoryUsedBytes)),
      memoryTotalBytes: latest.memoryTotalBytes,
      diskUsedBytes: latest.diskUsedBytes,
      diskTotalBytes: latest.diskTotalBytes,
      diskReadBytesPerSecond: average(points.map((point) => point.diskReadBytesPerSecond)),
      diskWriteBytesPerSecond: average(points.map((point) => point.diskWriteBytesPerSecond)),
      networkReceiveBytesPerSecond: average(
        points.map((point) => point.networkReceiveBytesPerSecond),
      ),
      networkTransmitBytesPerSecond: average(
        points.map((point) => point.networkTransmitBytesPerSecond),
      ),
      networkReceiveBytes: points.reduce((sum, point) => sum + point.networkReceiveBytes, 0),
      networkTransmitBytes: points.reduce((sum, point) => sum + point.networkTransmitBytes, 0),
      temperatureCelsius: average(points.map((point) => point.temperatureCelsius)),
    };
  });
};

export class SystemMetricsService {
  private previousRaw: RawSystemMetrics | null = null;
  private capturePromise: Promise<SystemMetricSample> | null = null;
  private warmupTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly databaseUrl: string,
    private readonly logger: MetricLogger,
    private readonly collector = collectRawSystemMetrics,
  ) {}

  public async start(): Promise<void> {
    await this.captureSafely();
    this.warmupTimer = setTimeout(() => void this.captureSafely(), 1_000);
    this.warmupTimer.unref();
    this.interval = setInterval(() => void this.captureSafely(), SYSTEM_METRICS_SAMPLE_INTERVAL_MS);
    this.interval.unref();
  }

  public async stop(): Promise<void> {
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    if (this.interval) clearInterval(this.interval);
    this.warmupTimer = null;
    this.interval = null;
    await this.capturePromise?.catch(() => undefined);
  }

  private async captureSafely(): Promise<void> {
    try {
      await this.capture();
    } catch (error) {
      this.logger.error({ err: error }, 'System metrics collection failed');
    }
  }

  public capture(): Promise<SystemMetricSample> {
    if (this.capturePromise) return this.capturePromise;
    this.capturePromise = this.captureOnce().finally(() => {
      this.capturePromise = null;
    });
    return this.capturePromise;
  }

  private async captureOnce(): Promise<SystemMetricSample> {
    const raw = await this.collector(this.databaseUrl);
    const persistedBaseline: PersistedCounterBaseline | null = this.previousRaw
      ? null
      : await this.prisma.systemMetricSample.findFirst({
          where: {
            recordedAt: { gte: new Date(raw.capturedAt.getTime() - SYSTEM_METRICS_RETENTION_MS) },
          },
          orderBy: { recordedAt: 'desc' },
        });
    const sameScope = (this.previousRaw?.scope ?? persistedBaseline?.scope) === raw.scope;
    const baselineAt = sameScope
      ? this.previousRaw?.capturedAt || persistedBaseline?.recordedAt || raw.capturedAt
      : raw.capturedAt;
    const elapsedSeconds = Math.max(0, (raw.capturedAt.getTime() - baselineAt.getTime()) / 1_000);
    const previousDiskRead = sameScope
      ? (this.previousRaw?.diskReadBytesTotal ?? persistedBaseline?.diskReadBytesTotal ?? null)
      : null;
    const previousDiskWrite = sameScope
      ? (this.previousRaw?.diskWriteBytesTotal ?? persistedBaseline?.diskWriteBytesTotal ?? null)
      : null;
    const previousInterface =
      this.previousRaw?.networkInterface ?? persistedBaseline?.networkInterface ?? null;
    const sameNetworkInterface = sameScope && previousInterface === raw.networkInterface;
    const previousNetworkReceive = sameNetworkInterface
      ? (this.previousRaw?.networkReceiveBytesTotal ??
        persistedBaseline?.networkReceiveBytesTotal ??
        null)
      : null;
    const previousNetworkTransmit = sameNetworkInterface
      ? (this.previousRaw?.networkTransmitBytesTotal ??
        persistedBaseline?.networkTransmitBytesTotal ??
        null)
      : null;
    const diskReadDelta = safeDelta(raw.diskReadBytesTotal, previousDiskRead);
    const diskWriteDelta = safeDelta(raw.diskWriteBytesTotal, previousDiskWrite);
    const networkReceiveDelta = safeDelta(raw.networkReceiveBytesTotal, previousNetworkReceive);
    const networkTransmitDelta = safeDelta(raw.networkTransmitBytesTotal, previousNetworkTransmit);
    const perSecond = (delta: bigint): number | null =>
      elapsedSeconds > 0 ? Number(delta) / elapsedSeconds : null;

    const [sample] = await this.prisma.$transaction([
      this.prisma.systemMetricSample.create({
        data: {
          recordedAt: raw.capturedAt,
          scope: raw.scope,
          cpuPercent: calculateCpuPercent(raw.cpu, this.previousRaw?.cpu || null, elapsedSeconds),
          memoryUsedBytes: raw.memoryUsedBytes,
          memoryTotalBytes: raw.memoryTotalBytes,
          diskUsedBytes: raw.diskUsedBytes,
          diskTotalBytes: raw.diskTotalBytes,
          diskReadBytesPerSecond: perSecond(diskReadDelta),
          diskWriteBytesPerSecond: perSecond(diskWriteDelta),
          diskReadBytesTotal: raw.diskReadBytesTotal,
          diskWriteBytesTotal: raw.diskWriteBytesTotal,
          networkReceiveBytesPerSecond: perSecond(networkReceiveDelta),
          networkTransmitBytesPerSecond: perSecond(networkTransmitDelta),
          networkReceiveBytesDelta: networkReceiveDelta,
          networkTransmitBytesDelta: networkTransmitDelta,
          networkReceiveBytesTotal: raw.networkReceiveBytesTotal,
          networkTransmitBytesTotal: raw.networkTransmitBytesTotal,
          networkInterface: raw.networkInterface,
          temperatureCelsius: raw.temperatureCelsius,
        },
      }),
      this.prisma.systemMetricSample.deleteMany({
        where: {
          recordedAt: { lt: new Date(raw.capturedAt.getTime() - SYSTEM_METRICS_RETENTION_MS) },
        },
      }),
    ]);
    this.previousRaw = raw;
    return sample;
  }

  public async getDashboard(): Promise<SystemMetricsDto> {
    let samples = await this.prisma.systemMetricSample.findMany({
      where: { recordedAt: { gte: new Date(Date.now() - SYSTEM_METRICS_RETENTION_MS) } },
      orderBy: { recordedAt: 'asc' },
    });
    if (samples.length === 0) samples = [await this.capture()];
    const current = samples.at(-1)!;
    const receivedBytes = samples.reduce(
      (sum, sample) => sum + Number(sample.networkReceiveBytesDelta),
      0,
    );
    const transmittedBytes = samples.reduce(
      (sum, sample) => sum + Number(sample.networkTransmitBytesDelta),
      0,
    );
    return {
      scope: current.scope === 'container' ? 'container' : 'host',
      sampleIntervalSeconds: SYSTEM_METRICS_SAMPLE_INTERVAL_MS / 1_000,
      retentionDays: SYSTEM_METRICS_RETENTION_MS / (24 * 60 * 60 * 1_000),
      current: toPoint(current),
      history: aggregateMetricHistory(samples),
      sevenDayBandwidth: {
        receivedBytes,
        transmittedBytes,
        totalBytes: receivedBytes + transmittedBytes,
      },
    };
  }
}
