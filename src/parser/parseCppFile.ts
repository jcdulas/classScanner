// Parses the text of one C++ file into FileSymbols.

import { CppParser } from './cppParser';
import { extractFileSymbols } from './declarationExtractor';
import { FileSymbols } from './fileSymbols';
import { stripMacros } from './macroStripper';

export function parseCppFile(
  parser: CppParser,
  sourceText: string,
  relativePath: string,
  ignoredMacros: string[],
): FileSymbols {
  const tree = parser.parse(stripMacros(sourceText, ignoredMacros));
  try {
    return extractFileSymbols(tree.rootNode, relativePath);
  } finally {
    // The tree lives in WebAssembly memory, which JavaScript's garbage collector does not manage.
    tree.delete();
  }
}
