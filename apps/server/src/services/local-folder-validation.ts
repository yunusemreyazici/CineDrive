import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalFolderValidationDto } from '@cinedrive/shared';

/** A shallow accessibility check, not a scan or a promise that every child is readable. */
export async function validateLocalFolder(folder: string): Promise<LocalFolderValidationDto> {
  if (!path.isAbsolute(folder)) throw new Error('LOCAL_FOLDER_UNAVAILABLE');
  await fs.access(folder, constants.R_OK | constants.X_OK);
  const directory = await fs.opendir(folder);
  await directory.close();
  return { readable: true };
}
