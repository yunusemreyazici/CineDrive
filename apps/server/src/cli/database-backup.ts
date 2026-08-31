import path from 'node:path';
import { env } from '../config/env.js';
import { createDatabaseBackup } from '../lib/database-backup.js';

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
};

const run = async (): Promise<void> => {
  const outputDirectory = argumentValue('--output-dir');
  const retentionValue = argumentValue('--retain');
  const retentionCount = retentionValue === undefined ? 14 : Number(retentionValue);

  const result = await createDatabaseBackup({
    databaseUrl: env.DATABASE_URL,
    ...(outputDirectory ? { destinationDirectory: path.resolve(outputDirectory) } : {}),
    retentionCount,
  });

  console.log(`Database backup created: ${result.backupPath}`);
  console.log(`Integrity: ${result.integrity.messages.join(', ')}`);
  console.log(`Size: ${result.bytes} bytes`);
  if (result.removedBackupPaths.length > 0) {
    console.log(`Expired backups removed: ${result.removedBackupPaths.length}`);
  }
};

run().catch((error: unknown) => {
  console.error('Database backup failed:', error);
  process.exitCode = 1;
});
