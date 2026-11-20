// Saves the source files of classes in a .zip archive.
//
// The archive is built in memory with fflate, a small zip library without
// native code. Source files are small, so even a few thousand of them fit
// comfortably in memory.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { zipEntryNames } from '../model/sourceFiles';

export type ArchiveLayout = 'tree' | 'flat';

/** Writes the archive and returns the number of files it contains. The paths are relative to `rootFolder`. */
export async function writeSourceArchive(
  rootFolder: string,
  relativePaths: string[],
  layout: ArchiveLayout,
  targetPath: string,
): Promise<number> {
  const entries: Record<string, Uint8Array> = {};
  for (const [relativePath, entryName] of zipEntryNames(relativePaths, layout)) {
    entries[entryName] = await readFile(path.join(rootFolder, relativePath));
  }
  await writeFile(targetPath, zipSync(entries, { level: 6 }));
  return relativePaths.length;
}
