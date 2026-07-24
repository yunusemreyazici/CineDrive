import type { FastifyPluginAsync } from 'fastify';

export const insightsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/insights/storage: Analyze Drive Storage & Quota
  fastify.get('/storage', async (request, reply) => {
    const userId = request.user!.id;
    const files = await fastify.prisma.driveFile.findMany({
      where: {
        status: 'active',
        library: {
          OR: [{ googleConnection: { userId } }, { googleConnectionId: null }],
        },
      },
      include: {
        library: true,
      },
    });

    const totalFiles = files.length;
    let totalSizeBytes = 0;

    const resolutionStats = {
      k4: { count: 0, sizeBytes: 0 },
      p1080: { count: 0, sizeBytes: 0 },
      p720: { count: 0, sizeBytes: 0 },
      sd: { count: 0, sizeBytes: 0 },
    };

    const nameMap = new Map<string, typeof files>();
    const md5Map = new Map<string, typeof files>();

    const largestFilesList: Array<{
      id: string;
      name: string;
      size: number;
      libraryName: string;
      googleDriveFileId: string;
    }> = [];

    for (const file of files) {
      const sizeNum = file.size ? Number(file.size) : 0;
      totalSizeBytes += sizeNum;

      // Classify resolution
      const fileNameLower = file.name.toLowerCase();
      if (fileNameLower.includes('2160p') || fileNameLower.includes('4k') || sizeNum > 8 * 1024 * 1024 * 1024) {
        resolutionStats.k4.count++;
        resolutionStats.k4.sizeBytes += sizeNum;
      } else if (fileNameLower.includes('1080p') || (sizeNum > 2.5 * 1024 * 1024 * 1024 && sizeNum <= 8 * 1024 * 1024 * 1024)) {
        resolutionStats.p1080.count++;
        resolutionStats.p1080.sizeBytes += sizeNum;
      } else if (fileNameLower.includes('720p') || (sizeNum > 1 * 1024 * 1024 * 1024 && sizeNum <= 2.5 * 1024 * 1024 * 1024)) {
        resolutionStats.p720.count++;
        resolutionStats.p720.sizeBytes += sizeNum;
      } else {
        resolutionStats.sd.count++;
        resolutionStats.sd.sizeBytes += sizeNum;
      }

      // Group for duplicates
      if (file.md5Checksum) {
        const list = md5Map.get(file.md5Checksum) || [];
        list.push(file);
        md5Map.set(file.md5Checksum, list);
      }

      const cleanName = fileNameLower.trim();
      const listByName = nameMap.get(cleanName) || [];
      listByName.push(file);
      nameMap.set(cleanName, listByName);

      largestFilesList.push({
        id: file.id,
        name: file.name,
        size: sizeNum,
        libraryName: file.library?.name || 'Bilinmeyen',
        googleDriveFileId: file.googleDriveFileId,
      });
    }

    // Sort largest files
    largestFilesList.sort((a, b) => b.size - a.size);
    const topLargestFiles = largestFilesList.slice(0, 10);

    // Identify duplicates
    const duplicates: Array<{
      id: string;
      name: string;
      size: number;
      libraryName: string;
      googleDriveFileId: string;
      reason: string;
    }> = [];

    const addedDuplicateIds = new Set<string>();

    for (const [md5, list] of md5Map.entries()) {
      if (list.length > 1) {
        for (const item of list) {
          if (!addedDuplicateIds.has(item.id)) {
            addedDuplicateIds.add(item.id);
            duplicates.push({
              id: item.id,
              name: item.name,
              size: item.size ? Number(item.size) : 0,
              libraryName: item.library?.name || 'Bilinmeyen',
              googleDriveFileId: item.googleDriveFileId,
              reason: `Aynı MD5 Özeti (${md5.substring(0, 8)}...)`,
            });
          }
        }
      }
    }

    for (const [, list] of nameMap.entries()) {
      if (list.length > 1) {
        for (const item of list) {
          if (!addedDuplicateIds.has(item.id)) {
            addedDuplicateIds.add(item.id);
            duplicates.push({
              id: item.id,
              name: item.name,
              size: item.size ? Number(item.size) : 0,
              libraryName: item.library?.name || 'Bilinmeyen',
              googleDriveFileId: item.googleDriveFileId,
              reason: 'Aynı Dosya Adı',
            });
          }
        }
      }
    }

    const averageSizeBytes = totalFiles > 0 ? Math.round(totalSizeBytes / totalFiles) : 0;

    return reply.status(200).send({
      totalFiles,
      totalSizeBytes,
      averageSizeBytes,
      resolutions: resolutionStats,
      duplicates,
      largestFiles: topLargestFiles,
    });
  });
};
