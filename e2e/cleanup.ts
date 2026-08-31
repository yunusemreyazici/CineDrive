import fs from 'node:fs';
import { e2eDatabasePath, e2eMediaRoot } from './env.js';

const sqliteSidecarSuffixes = ['', '-journal', '-wal', '-shm'];

export const removeE2EDatabase = (): void => {
  for (const suffix of sqliteSidecarSuffixes) {
    fs.rmSync(`${e2eDatabasePath}${suffix}`, { force: true });
  }
};

export const teardownE2EArtifacts = (): void => {
  removeE2EDatabase();
  fs.rmSync(e2eMediaRoot, { recursive: true, force: true });
};
