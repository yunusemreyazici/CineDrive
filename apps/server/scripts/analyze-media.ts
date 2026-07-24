import { PrismaClient } from '@prisma/client';
import { MediaProbeService } from '../src/services/media-probe.service.js';

const prisma = new PrismaClient();
const probeService = new MediaProbeService();
const CONCURRENCY = 2;

const main = async () => {
  const files = await prisma.driveFile.findMany({
    where: {
      storageType: 'local',
      localFilePath: { not: null },
      status: 'active',
      mediaAnalyzedAt: null,
      mimeType: { startsWith: 'video/' },
    },
    select: { id: true, name: true, localFilePath: true },
  });

  let analyzed = 0;
  let failed = 0;

  for (let index = 0; index < files.length; index += CONCURRENCY) {
    const batch = files.slice(index, index + CONCURRENCY);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const metadata = await probeService.probeLocalFile(file.localFilePath!);
          await prisma.driveFile.update({
            where: { id: file.id },
            data: metadata,
          });
          analyzed++;
          console.log(`[MediaAnalyze] ${analyzed}/${files.length}: ${file.name}`);
        } catch (error) {
          failed++;
          await prisma.driveFile.update({
            where: { id: file.id },
            data: {
              mediaAnalyzedAt: new Date(),
              mediaAnalysisError:
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : 'MEDIA_PROBE_FAILED',
            },
          });
          console.error(`[MediaAnalyze] Başarısız: ${file.name}`, error);
        }
      }),
    );
  }

  await prisma.$disconnect();
  console.log(`[MediaAnalyze] Tamamlandı. Başarılı: ${analyzed}, Hatalı: ${failed}`);
};

main().catch(async (error) => {
  console.error('[MediaAnalyze] Analiz tamamlanamadı.', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
