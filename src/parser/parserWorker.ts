// Entry point of a parser worker thread (spec §2.3).
//
// The extension host starts several of these workers (see
// src/scanner/parserPool.ts) so that files are parsed in parallel on several
// CPU cores. A worker receives batches of files, reads and parses them, and
// sends back one FileSymbols per file. It reads the files itself so that file
// contents never have to be copied between threads.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { CppParser } from './cppParser';
import { FileSymbols, createEmptyFileSymbols } from './fileSymbols';
import { parseCppFile } from './parseCppFile';
import { ParseBatchRequest, ParserWorkerMessage, ParserWorkerOptions } from './parserWorkerProtocol';

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
    for (const file of request.files) {
      results.push(await parseOneFile(parser, file.absolutePath, file.relativePath));
    }
    postResult({ type: 'batchParsed', batchId: request.batchId, results });
  } catch (error) {
    postResult({ type: 'batchFailed', batchId: request.batchId, message: String(error) });
  }
}

/** A file that cannot be read or parsed is reported as one parse error instead of failing the whole batch. */
async function parseOneFile(parser: CppParser, absolutePath: string, relativePath: string): Promise<FileSymbols> {
  try {
    const sourceText = await readFile(absolutePath, 'utf8');
    return parseCppFile(parser, sourceText, relativePath, options.ignoredMacros);
  } catch {
    return createEmptyFileSymbols(relativePath, 1);
  }
}

function postResult(message: ParserWorkerMessage): void {
  parentPort?.postMessage(message);
}
