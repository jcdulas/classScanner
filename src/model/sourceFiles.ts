// Finds the source files of a set of classes, for the "export sources as .zip" command.
//
// The files of a class are:
//   - the file that declares it (usually a header);
//   - the files that define its methods outside the class (usually .cpp files),
//     found by the scan;
//   - its "companion" files: files with the same name and another extension,
//     such as `engine.cpp` for `engine.h`.
//
// Headers and sources are often kept in separate trees, so a companion is not
// always next to its file. When several files have the right name, the one
// whose folders resemble most those of the file wins:
//   `inc/core/engine.h`           and `src/core/engine.cpp`   (mirror trees)
//   `include/myproject/engine.h`  and `src/engine.cpp`        (an extra folder level)

import path from 'node:path';
import { Graph } from '../shared/graphModel';

/** Paths of the files of the given classes, relative to the scanned folder, sorted. */
export function collectSourceFiles(graph: Graph, nodeIds: string[]): string[] {
  const companions = new CompanionFinder(graph.files);
  const wanted = new Set(nodeIds);
  const files = new Set<string>();
  for (const node of graph.nodes) {
    if (!wanted.has(node.id)) {
      continue;
    }
    const ownFiles = [node.file, ...(node.definitionFiles ?? [])].map((index) => graph.files[index]);
    for (const file of ownFiles) {
      files.add(file);
      for (const companion of companions.find(file)) {
        files.add(companion);
      }
    }
  }
  return Array.from(files).sort();
}

/**
 * Paths of the files inside the zip archive, by relative path of the source file.
 * `tree` keeps the folders of the scanned folder. `flat` puts every file at the root of the
 * archive; when two files have the same name, the folders are added to the name
 * (`core/util.h` becomes `core_util.h`).
 */
export function zipEntryNames(relativePaths: string[], layout: 'tree' | 'flat'): Map<string, string> {
  const names = new Map<string, string>();
  if (layout === 'tree') {
    for (const relativePath of relativePaths) {
      names.set(relativePath, relativePath);
    }
    return names;
  }
  const countByBaseName = new Map<string, number>();
  for (const relativePath of relativePaths) {
    const baseName = path.posix.basename(relativePath);
    countByBaseName.set(baseName, (countByBaseName.get(baseName) ?? 0) + 1);
  }
  for (const relativePath of relativePaths) {
    const baseName = path.posix.basename(relativePath);
    const isUnique = countByBaseName.get(baseName) === 1;
    names.set(relativePath, isUnique ? baseName : relativePath.replace(/\//g, '_'));
  }
  return names;
}

/** Score of two files in the same folder: better than any number of common folders. */
const SAME_FOLDER = Number.MAX_SAFE_INTEGER;

class CompanionFinder {
  /** Files by name without extension: `engine` for `src/core/engine.cpp`. */
  private readonly filesByStem = new Map<string, string[]>();

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

/** The number of folders the two paths have in common, counted from the file upward. */
function folderResemblance(first: string, second: string): number {
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

function stemOf(file: string): string {
  const baseName = path.posix.basename(file);
  const extension = path.posix.extname(baseName);
  return extension === '' ? baseName : baseName.slice(0, -extension.length);
}
