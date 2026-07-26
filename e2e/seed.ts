import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import ffmpegPath from 'ffmpeg-static';
import { PrismaClient } from '@prisma/client';
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_DATABASE_URL,
  schemaPath,
  e2eDatabasePath,
  e2eMediaRoot,
  e2eServerEnv,
  serverRoot,
} from './env.js';

/** Short enough to generate instantly, long enough for the player to buffer. */
const CLIP_SECONDS = 3;
const CLIP_NAME = 'Smoke Test Movie (2024).mp4';

const sidecarSuffixes = ['', '-journal', '-wal', '-shm'];

const removeDatabase = () => {
  for (const suffix of sidecarSuffixes) {
    fs.rmSync(`${e2eDatabasePath}${suffix}`, { force: true });
  }
};

/**
 * Renders a real, playable H.264 file so the streaming path is exercised end to
 * end rather than stubbed. A test that never moves bytes would not have caught
 * the route split this suite is meant to protect.
 */
const renderClip = (target: string) => {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary unavailable');

  const result = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=15:duration=${CLIP_SECONDS}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      '-c:a', 'aac', '-shortest',
      '-movflags', '+faststart',
      target,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  );

  if (result.status !== 0 || !fs.existsSync(target)) {
    throw new Error(`ffmpeg could not render the fixture clip:\n${result.stderr}`);
  }
};

export const seedE2EDatabase = async () => {
  removeDatabase();
  fs.rmSync(e2eMediaRoot, { recursive: true, force: true });
  fs.mkdirSync(e2eMediaRoot, { recursive: true });
  fs.mkdirSync(path.dirname(e2eDatabasePath), { recursive: true });

  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', schemaPath],
    {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
      stdio: 'inherit',
    },
  );

  const clipPath = path.join(e2eMediaRoot, CLIP_NAME);
  renderClip(clipPath);

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${e2eDatabasePath}` } },
  });

  try {
    // Libraries are owned, so the owner has to exist before them. The server's
    // own bootstrap (`ensureAdminUserExists`) matches on email and reuses this
    // row, so the account seeded here is the one the smoke test logs in as —
    // which is why the password has to be hashed the same way the server does.
    const owner = await prisma.user.create({
      data: {
        email: E2E_ADMIN_EMAIL,
        name: 'Administrator',
        passwordHash: await argon2.hash(E2E_ADMIN_PASSWORD),
        role: 'admin',
      },
    });

    // A local library has no Google connection, which is also the path that
    // needs no network access during the run.
    const library = await prisma.library.create({
      data: {
        userId: owner.id,
        name: 'E2E Local Library',
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: e2eMediaRoot,
      },
    });

    const driveFile = await prisma.driveFile.create({
      data: {
        libraryId: library.id,
        storageType: 'local',
        localFilePath: clipPath,
        name: CLIP_NAME,
        mimeType: 'video/mp4',
        size: BigInt(fs.statSync(clipPath).size),
        modifiedTime: new Date(),
        status: 'active',
        mediaContainer: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        mediaWidth: 320,
        mediaHeight: 180,
        mediaDuration: CLIP_SECONDS,
        mediaAnalyzedAt: new Date(),
      },
    });

    const mediaItem = await prisma.mediaItem.create({
      data: {
        id: 'e2e_movie_smoke',
        type: 'movie',
        title: 'Smoke Test Movie',
        normalizedTitle: 'smoke test movie',
        year: 2024,
        overview: 'Fixture used by the end-to-end smoke suite.',
        duration: CLIP_SECONDS,
        voteAverage: 8.1,
        genres: JSON.stringify(['Dram']),
        cast: JSON.stringify([{ name: 'E2E Oyuncu', character: 'Kendisi' }]),
        tmdbId: 999001,
      },
    });

    await prisma.movie.create({
      data: { mediaItemId: mediaItem.id, driveFileId: driveFile.id },
    });
  } finally {
    await prisma.$disconnect();
  }
};

export const teardownE2EDatabase = () => {
  removeDatabase();
  fs.rmSync(e2eMediaRoot, { recursive: true, force: true });
};

// Allows `tsx e2e/seed.ts` for debugging a failing run by hand.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  Object.assign(process.env, e2eServerEnv);
  seedE2EDatabase().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
