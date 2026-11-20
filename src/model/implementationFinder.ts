// Finds where a class is implemented, when that is another file than its declaration.
//
// The diagram uses it to offer two files to open for a class: its header and
// its source file (spec §4.6).

import { SourceLocation, isHeaderFile } from '../shared/graphModel';
import { CompanionFinder, stemOf } from './companionFiles';

export class ImplementationFinder {
  private readonly companions: CompanionFinder;
  private readonly indexByFile = new Map<string, number>();

  /** `files` are the files of the graph: nodes refer to them by index. */
  constructor(private readonly files: string[]) {
    this.companions = new CompanionFinder(files);
    files.forEach((file, index) => this.indexByFile.set(file, index));
  }

  /**
   * `definitionLines` gives, for each file that defines methods of the class outside of it,
   * the line of the first one.
   */
  find(declarationFile: number, definitionLines: Map<number, number>): SourceLocation | undefined {
    const declarationPath = this.files[declarationFile];
    const definitionFiles = Array.from(definitionLines.keys())
      .filter((file) => file !== declarationFile)
      .sort((first, second) => first - second);
    if (definitionFiles.length > 0) {
      // Methods can be spread over several files: the one named like the file of the
      // declaration (`engine.cpp` for `engine.h`) is the main one.
      const sameName = definitionFiles.find((file) => stemOf(this.files[file]) === stemOf(declarationPath));
      const file = sameName ?? definitionFiles[0];
      return { file, line: definitionLines.get(file)! };
    }
    // No method found in another file, but the header may still have a source file (static
    // members, free functions): its top is the best place to open.
    if (!isHeaderFile(declarationPath)) {
      return undefined;
    }
    const sourceFiles = this.companions
      .find(declarationPath)
      .filter((companion) => !isHeaderFile(companion))
      .sort();
    if (sourceFiles.length === 0) {
      return undefined;
    }
    return { file: this.indexByFile.get(sourceFiles[0])!, line: 1 };
  }
}
