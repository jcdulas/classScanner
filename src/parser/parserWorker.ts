// Entry point of a parser worker thread (spec §2.3).
//
// The extension host starts several of these workers (see
// src/scanner/parserPool.ts) so that files are parsed in parallel on several
// CPU cores. A worker receives batches of files, reads and parses them, and
// sends back one FileSymbols per file. It reads the files itself so that file
// contents never have to be copied between threads, and so that each worker
// waits for its own file on a slow disk (see sourceFileReader.ts).

import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { CppParser } from './cppParser';
import { FileSymbols, createEmptyFileSymbols } from './fileSymbols';
import { parseCppFile } from './parseCppFile';
import { ParseBatchRequest, ParserWorkerMessage, ParserWorkerOptions } from './parserWorkerProtocol';
import { readSourceFile } from './sourceFileReader';

const options = workerData as ParserWorkerOptions;
const parserReady = CppParser.create({
  // The build copies both WebAssembly files next to this worker script (see scripts/build.mjs).
  runtime: path.join(__dirname, 'web-tree-sitter.wasm'),
  cppGrammar: path.join(__dirname, 'tree-sitter-cpp.wasm'),
});

parentPort?.on('message', (request: ParseBatchRequest) => {
  void parseBatch(request);
});

async function parseBatch(request: ParseBatchRequest): Promise<void> {
  try {
    const parser = await parserReady;
    const results: FileSymbols[] = [];
    const skippedLargeFiles: string[] = [];
    for (const file of request.files) {
      const symbols = parseOneFile(parser, file.absolutePath, file.relativePath);
      if (symbols === undefined) {
        skippedLargeFiles.push(file.relativePath);
      } else {
        results.push(symbols);
      }
    }
    postResult({ type: 'batchParsed', batchId: request.batchId, results, skippedLargeFiles });
  } catch (error) {
    postResult({ type: 'batchFailed', batchId: request.batchId, message: String(error) });
  }
}

/**
 * Returns `undefined` for a file above the size limit. A file that cannot be read or parsed
 * is reported as one parse error instead of failing the whole batch.
 */
function parseOneFile(parser: CppParser, absolutePath: string, relativePath: string): FileSymbols | undefined {
  try {
    const sourceText = readSourceFile(absolutePath, options.maxFileSizeBytes);
    if (sourceText === undefined) {
      return undefined;
    }
    return parseCppFile(parser, sourceText, relativePath, options.ignoredMacros);
  } catch {
    return createEmptyFileSymbols(relativePath, 1);
  }
}

function postResult(message: ParserWorkerMessage): void {
  parentPort?.postMessage(message);
}
