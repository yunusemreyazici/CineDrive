import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import ffmpegPath from 'ffmpeg-static';
import { createPrismaClient } from '../apps/server/src/lib/prisma-client.js';
import { removeE2EDatabase } from './cleanup.js';
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

/** Resume requires >15s watched and >30s remaining; keep real media/DB durations aligned. */
const CLIP_SECONDS = 90;
const CLIP_NAME = 'Smoke Test Movie (2024).mp4';
const AUDIO_SECONDS = 4;
const AUDIO_NAME = '01 - Smoke Test Song.m4a';

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
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=320x180:rate=15:duration=${CLIP_SECONDS}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${CLIP_SECONDS}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      '-g',
      '30',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      target,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  );

  if (result.status !== 0 || !fs.existsSync(target)) {
    throw new Error(`ffmpeg could not render the fixture clip:\n${result.stderr}`);
  }
};

/** Creates a tagged AAC fixture with real embedded cover art. */
const renderAudio = (target: string, coverTarget: string) => {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary unavailable');

  const cover = spawnSync(
    ffmpegPath,
    ['-y', '-f', 'lavfi', '-i', 'color=c=0xD95C59:s=300x300', '-frames:v', '1', coverTarget],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  if (cover.status !== 0 || !fs.existsSync(coverTarget)) {
    throw new Error(`ffmpeg could not render the fixture artwork:\n${cover.stderr}`);
  }

  const audio = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=523.25:duration=${AUDIO_SECONDS}`,
      '-i',
      coverTarget,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-c:v',
      'mjpeg',
      '-disposition:v',
      'attached_pic',
      '-metadata',
      'title=Smoke Test Song',
      '-metadata',
      'artist=Fixture Artist',
      '-metadata',
      'album_artist=Fixture Artist',
      '-metadata',
      'album=Fixture Album',
      '-metadata',
      'track=1',
      '-metadata',
      'date=2026',
      '-metadata',
      'genre=Soundtrack',
      '-shortest',
      target,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  if (audio.status !== 0 || !fs.existsSync(target)) {
    throw new Error(`ffmpeg could not render the fixture audio:\n${audio.stderr}`);
  }
};

export const seedE2EDatabase = async () => {
  removeE2EDatabase();
  fs.rmSync(e2eMediaRoot, { recursive: true, force: true });
  fs.mkdirSync(e2eMediaRoot, { recursive: true });
  fs.mkdirSync(path.dirname(e2eDatabasePath), { recursive: true });

  execFileSync('npx', ['prisma', 'db', 'push', '--schema', schemaPath], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      ...(process.platform === 'darwin' ? { RUST_LOG: 'debug' } : {}),
    },
    stdio: 'inherit',
  });

  const clipPath = path.join(e2eMediaRoot, CLIP_NAME);
  const audioPath = path.join(e2eMediaRoot, AUDIO_NAME);
  const coverPath = path.join(e2eMediaRoot, 'cover.jpg');
  renderClip(clipPath);
  renderAudio(audioPath, coverPath);

  const prisma = createPrismaClient(E2E_DATABASE_URL);

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
        // Scans set this, and GET /api/media filters on it.
        libraryId: library.id,
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

    const audioFile = await prisma.driveFile.create({
      data: {
        id: '00000000-0000-4000-8000-000000000101',
        libraryId: library.id,
        storageType: 'local',
        localFilePath: audioPath,
        name: AUDIO_NAME,
        mimeType: 'audio/mp4',
        size: BigInt(fs.statSync(audioPath).size),
        modifiedTime: new Date(),
        status: 'active',
        mediaContainer: 'mov,mp4,m4a,3gp,3g2,mj2',
        audioCodec: 'aac',
        audioChannels: 1,
        audioSampleRate: 44100,
        audioBitrate: 192000,
        audioBitDepth: 16,
        audioLossless: false,
        mediaDuration: AUDIO_SECONDS,
        mediaAnalyzedAt: new Date(),
      },
    });
    const coverData = fs.readFileSync(coverPath);
    const artwork = await prisma.musicArtwork.create({
      data: {
        id: '00000000-0000-4000-8000-000000000102',
        userId: owner.id,
        mimeType: 'image/jpeg',
        data: coverData,
        checksum: createHash('sha256').update(coverData).digest('hex'),
      },
    });
    const artist = await prisma.musicArtist.create({
      data: {
        id: '00000000-0000-4000-8000-000000000103',
        userId: owner.id,
        name: 'Fixture Artist',
        normalizedName: 'fixture artist',
      },
    });
    const album = await prisma.musicAlbum.create({
      data: {
        id: '00000000-0000-4000-8000-000000000104',
        userId: owner.id,
        artistId: artist.id,
        artworkId: artwork.id,
        title: 'Fixture Album',
        normalizedTitle: 'fixture album',
        year: 2026,
        genres: JSON.stringify(['Soundtrack']),
        releaseType: 'album',
        secondaryTypes: JSON.stringify(['soundtrack']),
      },
    });
    const musicTrack = await prisma.musicTrack.create({
      data: {
        id: '00000000-0000-4000-8000-000000000105',
        libraryId: library.id,
        driveFileId: audioFile.id,
        albumId: album.id,
        primaryArtistId: artist.id,
        artworkId: artwork.id,
        title: 'Smoke Test Song',
        normalizedTitle: 'smoke test song',
        discNumber: 1,
        trackNumber: 1,
        year: 2026,
        genres: JSON.stringify(['Soundtrack']),
        duration: AUDIO_SECONDS,
        replayGainTrackDb: -3,
        replayGainTrackPeak: 0.92,
        artists: { create: { artistId: artist.id, position: 0 } },
      },
    });
    const lyricsContent =
      '[ar:Fixture Artist]\n[ti:Smoke Test Song]\n[00:00.00]Smoke test opening line\n[00:02.00]Smoke test second line';
    fs.writeFileSync(path.join(e2eMediaRoot, '01 - Smoke Test Song.lrc'), lyricsContent, 'utf8');
    await prisma.musicLyrics.create({
      data: {
        trackId: musicTrack.id,
        content: lyricsContent,
        translatedContent: '[00:00.00]Opening translation\n[00:02.00]Second translation',
        romanizedContent: '[00:00.00]Smoke test opening line\n[00:02.00]Smoke test second line',
        sourceName: '01 - Smoke Test Song.lrc',
        sourceType: 'sidecar',
        language: 'en',
        translationLang: 'tr',
        isSynced: true,
      },
    });
    await prisma.musicTrackCredit.createMany({
      data: [
        {
          trackId: musicTrack.id,
          name: 'Fixture Composer',
          role: 'composer',
          source: 'tag',
          position: 0,
        },
        {
          trackId: musicTrack.id,
          name: 'Fixture Producer',
          role: 'producer',
          source: 'tag',
          position: 1,
        },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
};

// Allows `tsx e2e/seed.ts` for debugging a failing run by hand.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  Object.assign(process.env, e2eServerEnv);
  seedE2EDatabase().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
