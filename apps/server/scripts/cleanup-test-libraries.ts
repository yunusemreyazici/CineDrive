import { env } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma-client.js';

/**
 * Removes libraries left behind by the server test suite.
 *
 * Before the suite was given its own database, every run created fixture
 * libraries in the development database; they accumulated into the hundreds.
 * The isolation is fixed, so this is a one-time cleanup of the backlog.
 *
 * Dry run by default. Pass `--apply` to actually delete.
 */

/** Names only ever produced by test fixtures, never by a real scan. */
const FIXTURE_LIBRARY_NAMES = [
  'Test Lib',
  'Movies Library',
  'Subtitle Test Library',
  'Streaming Test Library',
];

const prisma = createPrismaClient(env.DATABASE_URL);

const run = async () => {
  const apply = process.argv.includes('--apply');

  const doomed = await prisma.library.findMany({
    where: { name: { in: FIXTURE_LIBRARY_NAMES } },
    select: { id: true, name: true, _count: { select: { files: true } } },
  });

  if (doomed.length === 0) {
    console.log('Silinecek fixture kütüphanesi yok.');
    return;
  }

  const doomedIds = doomed.map((library) => library.id);

  // Deleting a library cascades to its DriveFiles. Anything a MediaItem still
  // points at must not be touched, so refuse rather than break the library.
  const referencedMovies = await prisma.movie.count({
    where: { driveFile: { libraryId: { in: doomedIds } } },
  });
  const referencedEpisodes = await prisma.episode.count({
    where: { driveFile: { libraryId: { in: doomedIds } } },
  });

  const fileCount = doomed.reduce((total, library) => total + library._count.files, 0);
  const byName = new Map<string, number>();
  for (const library of doomed) byName.set(library.name, (byName.get(library.name) || 0) + 1);

  console.log('Silinecek:');
  for (const [name, count] of byName) console.log(`  ${count.toString().padStart(4)} × ${name}`);
  console.log(`  ${fileCount} bağlı DriveFile`);

  if (referencedMovies > 0 || referencedEpisodes > 0) {
    console.error(
      `\nİPTAL: bu dosyalara ${referencedMovies} film ve ${referencedEpisodes} bölüm bağlı. ` +
        'Gerçek medya kaydı kırılmasın diye silme yapılmadı.',
    );
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('\nKuru çalışma. Uygulamak için: --apply');
    return;
  }

  const { count } = await prisma.library.deleteMany({
    where: { id: { in: doomedIds } },
  });
  console.log(`\n${count} kütüphane silindi.`);

  const [libraries, driveFiles, mediaItems] = await Promise.all([
    prisma.library.count(),
    prisma.driveFile.count(),
    prisma.mediaItem.count(),
  ]);
  console.log(`Kalan: ${libraries} kütüphane, ${driveFiles} dosya, ${mediaItems} medya.`);
};

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
