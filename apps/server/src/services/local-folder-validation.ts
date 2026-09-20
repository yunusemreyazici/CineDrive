import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalFolderValidationDto } from '@cinedrive/shared';

/** A shallow accessibility check, not a scan or a promise that every child is readable. */
export async function resolveLocalFolder(folder: string): Promise<string> {
  if (!path.isAbsolute(folder)) throw new Error('LOCAL_FOLDER_UNAVAILABLE');
  const resolved = await fs.realpath(folder);
  await fs.access(resolved, constants.R_OK | constants.X_OK);
  const directory = await fs.opendir(resolved);
  await directory.close();
  return resolved;
}

/** A shallow accessibility check, not a scan or a promise that every child is readable. */
export async function validateLocalFolder(folder: string): Promise<LocalFolderValidationDto> {
  await resolveLocalFolder(folder);
  return { readable: true };
}
