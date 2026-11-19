// Lists the C++ files to scan in a folder (spec §2.2).
//
// The walk honors the requested depth (0: only the folder itself, N: up to N
// levels of subfolders, -1: unlimited), skips excluded paths without entering
// them, and sets aside files that are too large to parse quickly.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';

export interface DiscoveryOptions {
  /** -1 means unlimited. */
  maxDepth: number;
  /** Extensions with their dot, for example `.cpp`. Compared without case. */
  extensions: string[];
  /** Glob patterns relative to the scanned folder, such as `**\/build/**`. */
  exclude: string[];
  maxFileSizeBytes: number;
}

export interface DiscoveredFile {
  absolutePath: string;
  /** Path relative to the scanned folder, with forward slashes. */
  relativePath: string;
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  /** Relative paths of the files larger than the size limit. */
  skippedLargeFiles: string[];
}

export async function discoverFiles(rootFolder: string, options: DiscoveryOptions): Promise<DiscoveryResult> {
  const isExcluded = picomatch(options.exclude, { dot: true });
  const extensions = new Set(options.extensions.map((extension) => extension.toLowerCase()));
  const result: DiscoveryResult = { files: [], skippedLargeFiles: [] };

  // An explicit stack instead of recursion: deep folder trees cannot overflow the call stack.
  const pending: { folder: string; relativeFolder: string; depth: number }[] = [
    { folder: rootFolder, relativeFolder: '', depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await readdir(current.folder, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = current.relativeFolder === '' ? entry.name : `${current.relativeFolder}/${entry.name}`;
      const absolutePath = path.join(current.folder, entry.name);
      if (entry.isDirectory()) {
        const canGoDeeper = options.maxDepth < 0 || current.depth < options.maxDepth;
        // A folder is tested with a trailing file name so that `**/build/**` matches the folder `build`.
        if (canGoDeeper && !isExcluded(`${relativePath}/x`)) {
          pending.push({ folder: absolutePath, relativeFolder: relativePath, depth: current.depth + 1 });
        }
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && !isExcluded(relativePath)) {
        await addFile(result, absolutePath, relativePath, options.maxFileSizeBytes);
      }
    }
  }
  result.files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
  result.skippedLargeFiles.sort();
  return result;
}

async function addFile(result: DiscoveryResult, absolutePath: string, relativePath: string, maxSize: number): Promise<void> {
  const fileStats = await stat(absolutePath);
  if (fileStats.size > maxSize) {
    result.skippedLargeFiles.push(relativePath);
  } else {
    result.files.push({ absolutePath, relativePath });
  }
}
