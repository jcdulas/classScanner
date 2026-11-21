// Lists the C++ files to scan in a folder (spec §2.2).
//
// The walk honors the requested depth (0: only the folder itself, N: up to N
// levels of subfolders, -1: unlimited) and skips excluded paths without
// entering them.
//
// It is written for slow file systems such as network drives, where each call
// waits for a round trip to the server (spec §2.3):
//   - a folder costs one call, which lists its entries with their kind. No
//     call is made per file: the size limit is checked later, when the file is
//     read (src/parser/sourceFileReader.ts);
//   - the folders of one level of the tree are listed several at a time.

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { mapConcurrently } from './concurrency';

export interface DiscoveryOptions {
  /** -1 means unlimited. */
  maxDepth: number;
  /** Extensions with their dot, for example `.cpp`. Compared without case. */
  extensions: string[];
  /** Glob patterns relative to the scanned folder, such as `**\/build/**`. */
  exclude: string[];
}

export interface DiscoveredFile {
  absolutePath: string;
  /** Path relative to the listed folder, with forward slashes. */
  relativePath: string;
}

interface FolderToList {
  absolutePath: string;
  /** Empty for the listed folder itself. */
  relativePath: string;
  depth: number;
}

interface FolderListing {
  files: DiscoveredFile[];
  subfolders: FolderToList[];
}

/**
 * Folders listed at the same time. Node runs at most 4 file system calls at once by default,
 * so a higher number only keeps its queue full.
 */
const FOLDERS_LISTED_AT_ONCE = 16;

/** The same rules apply while walking a scan root and when a saved file is considered for a rescan. */
export class DiscoveryFilter {
  private readonly isExcluded: (relativePath: string) => boolean;
  private readonly extensions: Set<string>;

  constructor(private readonly options: DiscoveryOptions) {
    this.isExcluded = picomatch(options.exclude, { dot: true });
    this.extensions = new Set(options.extensions.map((extension) => extension.toLowerCase()));
  }

  includesFile(relativePath: string): boolean {
    return this.extensions.has(path.extname(relativePath).toLowerCase()) && !this.isExcluded(relativePath);
  }

  entersFolder(relativePath: string, depth: number): boolean {
    return (this.options.maxDepth < 0 || depth <= this.options.maxDepth)
      && !this.isExcluded(relativePath) && !this.isExcluded(relativePath + '/');
  }

  includesSavedFile(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return false;
    }
    const parts = relative.split(path.sep);
    if (!this.includesFile(parts.join('/'))) return false;
    let folder = '';
    for (let depth = 1; depth < parts.length; depth++) {
      folder += (depth === 1 ? '' : '/') + parts[depth - 1];
      if (!this.entersFolder(folder, depth)) return false;
    }
    return true;
  }
}

export async function discoverFiles(rootFolder: string, options: DiscoveryOptions): Promise<DiscoveredFile[]> {
  const filter = new DiscoveryFilter(options);

  const listFolder = async (folder: FolderToList): Promise<FolderListing> => {
    const listing: FolderListing = { files: [], subfolders: [] };
    const entries = await readdir(folder.absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = folder.relativePath === '' ? entry.name : `${folder.relativePath}/${entry.name}`;
      const absolutePath = path.join(folder.absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (filter.entersFolder(relativePath, folder.depth + 1)) {
          listing.subfolders.push({ absolutePath, relativePath, depth: folder.depth + 1 });
        }
      } else if (entry.isFile() && filter.includesFile(relativePath)) {
        listing.files.push({ absolutePath, relativePath });
      }
    }
    return listing;
  };

  // One level of the tree after the other: the folders of a level are listed together, and
  // their subfolders make the next level. No recursion, so deep trees cannot overflow the call stack.
  const files: DiscoveredFile[] = [];
  let level: FolderToList[] = [{ absolutePath: rootFolder, relativePath: '', depth: 0 }];
  while (level.length > 0) {
    const listings = await mapConcurrently(level, FOLDERS_LISTED_AT_ONCE, listFolder);
    level = [];
    for (const listing of listings) {
      files.push(...listing.files);
      level.push(...listing.subfolders);
    }
  }
  files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
  return files;
}
