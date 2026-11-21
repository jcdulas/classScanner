// The files a class can be opened in from the diagram (spec §4.6): the file
// that declares it, usually a header, and the file that implements it, usually
// a .cpp, when the scan found one. The selection bar and the context menu show
// one entry per file, so that the user chooses which one to open.
//
// A double-click on a card, and a search result, open one of the two places
// without asking: `codeLocationOf` gives the place for the side that the user
// prefers, the declaration or the definition.

import { ClassNode, CodeSide, Member, SourceLocation, isHeaderFile } from '../../shared/graphModel';

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

/**
 * Where to open a class, or one of its members when `member` is given, on the asked side.
 * What has no definition of its own opens at its declaration: an attribute, a method written
 * in the body of its class, a class that lives in a single file.
 */
export function codeLocationOf(node: ClassNode, member: Member | undefined, side: CodeSide): SourceLocation {
  const declaration = member ?? node;
  const definition = member === undefined ? node.implementation : member.definition;
  if (side === 'definition' && definition !== undefined) {
    return definition;
  }
  return { file: declaration.file, line: declaration.line };
}

export function otherCodeSide(side: CodeSide): CodeSide {
  return side === 'definition' ? 'declaration' : 'definition';
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
