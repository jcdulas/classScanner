// A ParseFilesFunction that parses in the current thread, one file after another.
//
// Used by the unit tests and the benchmark, where starting worker threads
// would need the bundled worker script. The extension uses parserPool.ts.

import { readFile } from 'node:fs/promises';
import { CppParser, WasmPaths } from '../parser/cppParser';
import { FileSymbols } from '../parser/fileSymbols';
import { parseCppFile } from '../parser/parseCppFile';
import { ParseFilesFunction } from './scanFolder';

export function createInProcessParseFunction(wasmPaths: WasmPaths, ignoredMacros: string[]): ParseFilesFunction {
  return async (files, onProgress) => {
    const parser = await CppParser.create(wasmPaths);
    const results: FileSymbols[] = [];
    for (const file of files) {
      const sourceText = await readFile(file.absolutePath, 'utf8');
      results.push(parseCppFile(parser, sourceText, file.relativePath, ignoredMacros));
      onProgress(results.length);
    }
    return results;
  };
}
