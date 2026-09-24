import fs from 'node:fs';
import { e2eDatabasePath } from './env.js';

const sqliteSidecarSuffixes = ['', '-journal', '-wal', '-shm'];

export const removeE2EDatabase = (): void => {
  for (const suffix of sqliteSidecarSuffixes) {
    fs.rmSync(`${e2eDatabasePath}${suffix}`, { force: true });
  }
};
