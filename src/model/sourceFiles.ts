// Finds the source files of a set of classes, for the "export sources as .zip" command.
//
// The files of a class are:
//   - the file that declares it (usually a header);
//   - the files that define its methods outside the class (usually .cpp files),
//     found by the scan;
//   - its "companion" files: files with the same name and another extension,
//     such as `engine.cpp` for `engine.h` (companionFiles.ts).

import path from 'node:path';
import { Graph } from '../shared/graphModel';
import { CompanionFinder } from './companionFiles';

/** Paths of the files of the given classes, relative to the root of the graph, sorted. */
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
