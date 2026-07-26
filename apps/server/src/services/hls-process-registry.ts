import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export type ProcessRegistryEntry = {
  jobId: string;
  pid: number;
  cacheKey: string;
  startedAt: number;
};

/** A process lookup that hangs must not delay startup; treat it as "gone". */
const PROCESS_LOOKUP_TIMEOUT_MS = 5_000;

/** Reads a process's command line without blocking the event loop. */
const describeProcess = (pid: number): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn('ps', ['-p', String(pid), '-o', 'command='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';
    let settled = false;
    const finish = (output: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish('');
    }, PROCESS_LOOKUP_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => finish(''));
    child.on('close', () => finish(stdout));
  });

/**
 * Tracks the FFmpeg processes this server started, on disk as well as in
 * memory, so a crash or a hard restart does not leave encoders running against
 * the cache directory forever.
 *
 * Extracted from HlsService: unlike the job scheduling around it, this touches
 * none of the live job, lease or slot state — only its own file.
 */
export class HlsProcessRegistry {
  private readonly entries = new Map<string, ProcessRegistryEntry>();

  constructor(
    private readonly registryPath: string,
    private readonly cacheRoot: string,
  ) {}

  public register(entry: ProcessRegistryEntry) {
    this.entries.set(entry.jobId, entry);
    this.persist();
  }

  public unregister(jobId: string) {
    if (!this.entries.delete(jobId)) return;
    this.persist();
  }

  /**
   * Kills FFmpeg processes left behind by a previous run.
   *
   * Only processes whose command line still names this server's FFmpeg binary,
   * this cache root and an HLS output are signalled, so a recycled PID
   * belonging to something else is never touched.
   */
  public async reapOrphans() {
    let entries: ProcessRegistryEntry[] = [];
    try {
      entries = JSON.parse(await fsp.readFile(this.registryPath, 'utf8')) as ProcessRegistryEntry[];
    } catch {
      // A missing or invalid registry is equivalent to an empty registry.
    }

    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.pid) || entry.pid <= 0) continue;

      const command = await describeProcess(entry.pid);
      if (
        !command.includes(String(ffmpegPath)) ||
        !command.includes(this.cacheRoot) ||
        !command.includes('-f hls')
      ) {
        continue;
      }

      try {
        process.kill(entry.pid, 'SIGKILL');
      } catch {
        // The process exited between the probe and the signal.
      }
    }

    this.persist();
  }

  private persist() {
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify([...this.entries.values()]));
    } catch {
      // Observability must never interrupt playback.
    }
  }
}
