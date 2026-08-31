import path from 'node:path';
import { env } from '../config/env.js';
import { restoreDatabaseBackup } from '../lib/database-backup.js';

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
};

const run = async (): Promise<void> => {
  const source = argumentValue('--from');
  if (!source) throw new Error('Usage: db:restore -- --from <backup.db> [--apply]');

  const apply = process.argv.includes('--apply');
  const result = await restoreDatabaseBackup({
    databaseUrl: env.DATABASE_URL,
    backupPath: path.resolve(source),
    apply,
  });

  if (!result.applied) {
    console.log(`Backup verified: ${result.backupPath}`);
    console.log(`Restore target: ${result.targetPath}`);
    console.log('Dry run only. Stop CineDrive, then repeat with --apply to restore.');
    return;
  }

  console.log(`Database restored from: ${result.backupPath}`);
  console.log(`Restore target: ${result.targetPath}`);
  if (result.preRestoreBackupPath) {
    console.log(`Pre-restore safety backup: ${result.preRestoreBackupPath}`);
  }
};

run().catch((error: unknown) => {
  console.error('Database restore failed:', error);
  process.exitCode = 1;
});
