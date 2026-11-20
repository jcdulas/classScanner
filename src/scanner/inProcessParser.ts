// A ParseFilesFunction that parses in the current thread, one file after another.
//
// Used by the unit tests and the benchmark, where starting worker threads
// would need the bundled worker script. The extension uses parserPool.ts.

import { CppParser, WasmPaths } from '../parser/cppParser';
import { FileSymbols } from '../parser/fileSymbols';
import { parseCppFile } from '../parser/parseCppFile';
import { ParserWorkerOptions } from '../parser/parserWorkerProtocol';
import { readSourceFile } from '../parser/sourceFileReader';
import { ParseFilesFunction } from './scanFolder';

/** `options` are the same as for the worker threads. */
export function createInProcessParseFunction(wasmPaths: WasmPaths, options: ParserWorkerOptions): ParseFilesFunction {
  return async (files, onProgress) => {
    const parser = await CppParser.create(wasmPaths);
    const fileSymbols: FileSymbols[] = [];
    const skippedLargeFiles: string[] = [];
    for (const file of files) {
      const sourceText = readSourceFile(file.absolutePath, options.maxFileSizeBytes);
      if (sourceText === undefined) {
        skippedLargeFiles.push(file.relativePath);
      } else {
        fileSymbols.push(parseCppFile(parser, sourceText, file.relativePath, options.ignoredMacros));
      }
      onProgress(fileSymbols.length + skippedLargeFiles.length);
    }
    return { fileSymbols, skippedLargeFiles };
  };
}
