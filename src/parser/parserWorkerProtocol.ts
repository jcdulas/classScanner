// Messages exchanged between the parser pool (src/scanner/parserPool.ts) and
// each parser worker thread (parserWorker.ts).
//
// They live in their own module so that the pool can import them without
// importing the worker script itself, whose top-level code starts a worker.

import { FileSymbols } from './fileSymbols';

/** Passed once to each worker, as its `workerData`. */
export interface ParserWorkerOptions {
  ignoredMacros: string[];
}

export interface ParseBatchRequest {
  batchId: number;
  files: { absolutePath: string; relativePath: string }[];
}

export type ParserWorkerMessage =
  | { type: 'batchParsed'; batchId: number; results: FileSymbols[] }
  | { type: 'batchFailed'; batchId: number; message: string };
