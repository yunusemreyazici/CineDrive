import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '@cinedrive/prisma';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export class MusicReplayGainService {
  constructor(private readonly prisma: PrismaClient) {}

  public async scan(userId: string, trackIds: string[]) {
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_AVAILABLE');
    const binaryPath = ffmpegPath;
    const tracks = await this.prisma.musicTrack.findMany({
      where: { id: { in: trackIds }, library: { userId } },
      select: { id: true, driveFile: { select: { localFilePath: true } } },
    });
    const updated: string[] = [];
    const skipped: string[] = [];
    await Promise.all(
      tracks.map(async (track) => {
        if (!track.driveFile.localFilePath) {
          skipped.push(track.id);
          return;
        }
        try {
          const { stderr } = await execFileAsync(
          binaryPath,
            [
              '-hide_banner',
              '-nostdin',
              '-i',
              track.driveFile.localFilePath,
              '-af',
              'volumedetect',
              '-f',
              'null',
              '-',
            ],
            { maxBuffer: 2 * 1024 * 1024 },
          );
          const mean = Number(stderr.match(/mean_volume:\s*(-?[\d.]+) dB/i)?.[1]);
          const peakDb = Number(stderr.match(/max_volume:\s*(-?[\d.]+) dB/i)?.[1]);
          if (!Number.isFinite(mean) || !Number.isFinite(peakDb))
            throw new Error('LOUDNESS_NOT_FOUND');
          await this.prisma.musicTrack.update({
            where: { id: track.id },
            data: {
              replayGainTrackDb: clamp(-18 - mean, -20, 20),
              replayGainTrackPeak: Math.pow(10, peakDb / 20),
            },
          });
          updated.push(track.id);
        } catch {
          skipped.push(track.id);
        }
      }),
    );
    return { updated, skipped };
  }
}
