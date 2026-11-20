// The files a class can be opened in from the diagram (spec §4.6): the file
// that declares it, usually a header, and the file that implements it, usually
// a .cpp, when the scan found one. The selection bar and the context menu show
// one entry per file, so that the user chooses which one to open.

import { ClassNode, isHeaderFile } from '../../shared/graphModel';

export interface OpenTarget {
  /** File name without its folders, shown on the control: `engine.h`. */
  fileName: string;
  /** What opening it shows, for the tooltip. */
  description: string;
  /** A header and a source file get different icons, to tell them apart when names are hidden. */
  isHeader: boolean;
  /** Index in Graph.files. */
  file: number;
  /** 1-based line. */
  line: number;
}

/** The declaration first, then the implementation when it is in another file. */
export function openTargetsOf(node: ClassNode, files: string[]): OpenTarget[] {
  const targets: OpenTarget[] = [
    {
      fileName: fileNameOf(files[node.file]),
      description: `Open the declaration of ${node.name} in ${files[node.file]}`,
      isHeader: isHeaderFile(files[node.file]),
      file: node.file,
      line: node.line,
    },
  ];
  const implementation = node.implementation;
  if (implementation !== undefined) {
    targets.push({
      fileName: fileNameOf(files[implementation.file]),
      description: `Open the implementation of ${node.name} in ${files[implementation.file]}`,
      isHeader: isHeaderFile(files[implementation.file]),
      file: implementation.file,
      line: implementation.line,
    });
  }
  return targets;
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
