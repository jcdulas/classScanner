// Finds the project file that an `#include` directive refers to (spec §3, include relation).
//
// Without the compiler's include paths, an include is matched in two steps:
//   1. relative to the folder of the including file, as the compiler does for `#include "..."`;
//   2. otherwise, any project file whose path ends with the included path, so
//      that `#include <mylib/core/engine.h>` finds `include/mylib/core/engine.h`,
//      and `#include "engine.h"` in `src/core/engine.cpp` finds `inc/core/engine.h`.
// Includes that match no scanned file, such as `<vector>`, are ignored.

import path from 'node:path';
import { folderResemblance } from './companionFiles';

export class IncludeResolver {
  private readonly projectFiles: Set<string>;
  private readonly filesByBaseName = new Map<string, string[]>();

  /** `projectFiles` are paths relative to the scanned folder, with forward slashes. */
  constructor(projectFiles: string[]) {
    this.projectFiles = new Set(projectFiles);
    for (const file of projectFiles) {
      const baseName = path.posix.basename(file);
      const sameBaseName = this.filesByBaseName.get(baseName) ?? [];
      sameBaseName.push(file);
      this.filesByBaseName.set(baseName, sameBaseName);
    }
  }

  resolve(includingFile: string, includePath: string): string | undefined {
    const normalizedInclude = includePath.replace(/\\/g, '/');
    const relativeCandidate = path.posix.normalize(
      path.posix.join(path.posix.dirname(includingFile), normalizedInclude),
    );
    if (this.projectFiles.has(relativeCandidate)) {
      return relativeCandidate;
    }

    const sameBaseName = this.filesByBaseName.get(path.posix.basename(normalizedInclude)) ?? [];
    const matches = sameBaseName.filter(
      (file) => file === normalizedInclude || file.endsWith(`/${normalizedInclude}`),
    );
    if (matches.length === 0) {
      return undefined;
    }
    // Several matches are possible (`inc/core/util.h` and `inc/net/util.h` for `util.h`). The
    // file whose folders resemble most those of the including file wins: `src/core/engine.cpp`
    // most likely includes the `util.h` of `inc/core`. Then the shortest path wins.
    const resemblance = (file: string) => folderResemblance(includingFile, file);
    matches.sort(
      (first, second) => resemblance(second) - resemblance(first) || first.length - second.length || first.localeCompare(second),
    );
    return matches[0];
  }
}
