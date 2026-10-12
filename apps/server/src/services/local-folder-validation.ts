import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LocalFolderValidationDto } from '@cinedrive/shared';

const protectedSystemRoots = [
  '/Applications',
  '/Library',
  '/System',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/private/etc',
  '/private/var',
  '/proc',
  '/root',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
];

export const isPathWithinRoot = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const isTestTemporaryPath = (resolved: string) => {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') return false;
  const temporaryRoot = path.resolve(os.tmpdir());
  const realpathTemporaryRoot = path.join('/private', temporaryRoot.replace(/^\/+/, ''));
  return (
    isPathWithinRoot(temporaryRoot, resolved) || isPathWithinRoot(realpathTemporaryRoot, resolved)
  );
};

const assertSafeLibraryRoot = (resolved: string) => {
  if (resolved === path.parse(resolved).root) throw new Error('LOCAL_FOLDER_UNSAFE');

  // Do not let an admin turn the application checkout/data directory into a
  // media root. This also prevents a later scan from indexing secrets,
  // migrations or runtime cache files stored next to the server.
  const applicationRoot = path.resolve(process.cwd());
  if (isPathWithinRoot(applicationRoot, resolved) || isPathWithinRoot(resolved, applicationRoot)) {
    throw new Error('LOCAL_FOLDER_UNSAFE');
  }

  if (
    protectedSystemRoots.some(
      (root) => isPathWithinRoot(root, resolved) || isPathWithinRoot(resolved, root),
    ) &&
    !isTestTemporaryPath(resolved)
  ) {
    throw new Error('LOCAL_FOLDER_UNSAFE');
  }
};

/** A shallow accessibility check, not a scan or a promise that every child is readable. */
export async function resolveLocalFolder(folder: string): Promise<string> {
  if (!path.isAbsolute(folder)) throw new Error('LOCAL_FOLDER_UNAVAILABLE');
  const resolved = await fs.realpath(folder);
  assertSafeLibraryRoot(resolved);
  await fs.access(resolved, constants.R_OK | constants.X_OK);
  const directory = await fs.opendir(resolved);
  await directory.close();
  return resolved;
}

/** Resolve a stored media path without allowing it to escape its library root. */
export async function resolveSafePathWithinRoot(
  root: string,
  storedPath: string | null | undefined,
): Promise<string> {
  if (!storedPath || !path.isAbsolute(storedPath)) {
    throw new Error('LOCAL_FILE_UNAVAILABLE');
  }

  const [resolvedRoot, resolvedFile] = await Promise.all([
    fs.realpath(root),
    fs.realpath(storedPath),
  ]);
  if (!isPathWithinRoot(resolvedRoot, resolvedFile)) {
    throw new Error('LOCAL_FILE_UNAVAILABLE');
  }

  const stat = await fs.stat(resolvedFile);
  if (!stat.isFile()) throw new Error('LOCAL_FILE_UNAVAILABLE');
  return resolvedFile;
}

/** Resolve a stored media path after validating its configured library root. */
export async function resolveSafeLocalFile(
  libraryRoot: string | null | undefined,
  storedPath: string | null | undefined,
): Promise<string> {
  if (!libraryRoot) throw new Error('LOCAL_FILE_UNAVAILABLE');
  const resolvedRoot = await resolveLocalFolder(libraryRoot);
  return resolveSafePathWithinRoot(resolvedRoot, storedPath);
}

/** Replace a sidecar atomically, never opening the destination for writing.
 * Renaming a private sibling file replaces a raced-in symlink rather than
 * following it. Existing symlinks (including dangling ones) are rejected. */
export async function writeSafeLyricsSidecar(
  libraryRoot: string | null | undefined,
  mediaFilePath: string | null | undefined,
  content: string,
): Promise<string> {
  const media = await resolveSafeLocalFile(libraryRoot, mediaFilePath);
  const parent = path.dirname(media);
  const target = path.join(parent, `${path.parse(media).name}.lrc`);
  const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error('LOCAL_SIDECAR_UNSAFE');
  }
  const temporary = path.join(parent, `.cinedrive-lyrics-${randomUUID()}.tmp`);
  const handle = await fs.open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    existing ? existing.mode & 0o777 : 0o644,
  );
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    // Revalidate the source/root after the asynchronous write before publish.
    if (
      (await resolveSafeLocalFile(libraryRoot, mediaFilePath)) !== media ||
      (await fs.realpath(parent)) !== parent
    ) {
      throw new Error('LOCAL_SIDECAR_UNSAFE');
    }
    await fs.rename(temporary, target);
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return path.basename(target);
}

/** A shallow accessibility check, not a scan or a promise that every child is readable. */
export async function validateLocalFolder(folder: string): Promise<LocalFolderValidationDto> {
  await resolveLocalFolder(folder);
  return { readable: true };
}
