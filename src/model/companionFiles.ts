// Finds the "companion" files of a file: files with the same name and another
// extension, such as `engine.cpp` for `engine.h`.
//
// Headers and sources are often kept in separate trees, so a companion is not
// always next to its file. When several files have the right name, the one
// whose folders resemble most those of the file wins:
//   `inc/core/engine.h`           and `src/core/engine.cpp`   (mirror trees)
//   `include/myproject/engine.h`  and `src/engine.cpp`        (an extra folder level)
//
// Used to collect the sources of a class (sourceFiles.ts), to find the file
// that implements a class (implementationFinder.ts) and to choose between
// several files that match an include (includeResolver.ts).

import path from 'node:path';

/** Score of two files in the same folder: better than any number of common folders. */
const SAME_FOLDER = Number.MAX_SAFE_INTEGER;

/** The name of a file without its folders and its extension: `engine` for `src/core/engine.cpp`. */
export function stemOf(file: string): string {
  const baseName = path.posix.basename(file);
  const extension = path.posix.extname(baseName);
  return extension === '' ? baseName : baseName.slice(0, -extension.length);
}

/**
 * How much the folders of two files resemble each other: the number of folders the two paths
 * have in common, counted from the file upward. `inc/core/engine.h` and `src/core/engine.cpp`
 * have one folder in common (`core`).
 */
export function folderResemblance(first: string, second: string): number {
  const firstFolders = path.posix.dirname(first).split('/');
  const secondFolders = path.posix.dirname(second).split('/');
  if (firstFolders.join('/') === secondFolders.join('/')) {
    return SAME_FOLDER;
  }
  let common = 0;
  while (
    common < firstFolders.length &&
    common < secondFolders.length &&
    firstFolders[firstFolders.length - 1 - common] === secondFolders[secondFolders.length - 1 - common]
  ) {
    common++;
  }
  return common;
}

export class CompanionFinder {
  /** Files by name without extension: `engine` for `src/core/engine.cpp`. */
  private readonly filesByStem = new Map<string, string[]>();

  /** `files` are paths with forward slashes, relative to the same folder. */
  constructor(files: string[]) {
    for (const file of files) {
      const stem = stemOf(file);
      const sameStem = this.filesByStem.get(stem) ?? [];
      sameStem.push(file);
      this.filesByStem.set(stem, sameStem);
    }
  }

  /**
   * The companions of a file. Two files are companions when each one is the best match of
   * the other: `src/core/util.cpp` goes with `inc/core/util.h`, so it is not also taken as
   * the companion of `inc/net/util.h`.
   */
  find(file: string): string[] {
    return this.bestMatches(file).filter((candidate) => this.bestMatches(candidate).includes(file));
  }

  /**
   * The files with the same name and another extension whose folders resemble most those of
   * `file`. Without any folder in common, a file is only kept when it is the only candidate.
   */
  private bestMatches(file: string): string[] {
    const extension = path.posix.extname(file);
    const candidates = (this.filesByStem.get(stemOf(file)) ?? []).filter((candidate) => path.posix.extname(candidate) !== extension);
    if (candidates.length === 0) {
      return [];
    }
    const scores = candidates.map((candidate) => folderResemblance(file, candidate));
    const bestScore = Math.max(...scores);
    const best = candidates.filter((_, index) => scores[index] === bestScore);
    return bestScore === 0 && best.length > 1 ? [] : best;
  }
}
