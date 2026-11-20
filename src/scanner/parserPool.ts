// A pool of worker threads that parse C++ files in parallel (spec §2.3).
//
// Files are sent in small batches: one message per file would cost more in
// thread communication than the parsing itself, while one huge batch per
// worker would leave some workers idle at the end if their files are slower.
// Each worker takes the next batch as soon as it finishes the previous one.

import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { FileSymbols } from '../parser/fileSymbols';
import { ParseBatchRequest, ParserWorkerMessage, ParserWorkerOptions } from '../parser/parserWorkerProtocol';
import { DiscoveredFile } from './fileDiscovery';
import { ParseFilesFunction, ParsedFiles } from './scanFolder';

const FILES_PER_BATCH = 20;
const MAX_WORKER_COUNT = 8;

/**
 * Returns a ParseFilesFunction backed by worker threads running `workerScriptPath`
 * (the bundled `dist/parserWorker.js`). The workers are stopped when parsing ends.
 */
export function createWorkerParseFunction(workerScriptPath: string, options: ParserWorkerOptions): ParseFilesFunction {
  return (files, onProgress, isCancelled) => parseWithWorkers(workerScriptPath, options, files, onProgress, isCancelled);
}

function parseWithWorkers(
  workerScriptPath: string,
  options: ParserWorkerOptions,
  files: DiscoveredFile[],
  onProgress: (parsedFileCount: number) => void,
  isCancelled: () => boolean,
): Promise<ParsedFiles> {
  const batches: DiscoveredFile[][] = [];
  for (let start = 0; start < files.length; start += FILES_PER_BATCH) {
    batches.push(files.slice(start, start + FILES_PER_BATCH));
  }
  // Keep one core for the extension host and the VS Code user interface.
  const workerCount = Math.max(1, Math.min(MAX_WORKER_COUNT, os.cpus().length - 1, batches.length));

  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const results: FileSymbols[] = [];
    const skippedLargeFiles: string[] = [];
    let nextBatchIndex = 0;
    let finishedBatchCount = 0;
    let isSettled = false;

    const stopAll = () => {
      isSettled = true;
      for (const worker of workers) {
        void worker.terminate();
      }
    };

    const sendNextBatch = (worker: Worker) => {
      if (nextBatchIndex >= batches.length) {
        return;
      }
      const request: ParseBatchRequest = {
        batchId: nextBatchIndex,
        files: batches[nextBatchIndex].map((file) => ({ absolutePath: file.absolutePath, relativePath: file.relativePath })),
      };
      nextBatchIndex++;
      worker.postMessage(request);
    };

    const handleMessage = (worker: Worker, message: ParserWorkerMessage) => {
      if (isSettled) {
        return;
      }
      if (isCancelled()) {
        stopAll();
        reject(new ScanCancelledError());
        return;
      }
      if (message.type === 'batchFailed') {
        stopAll();
        reject(new Error(`A parser worker failed: ${message.message}`));
        return;
      }
      results.push(...message.results);
      skippedLargeFiles.push(...message.skippedLargeFiles);
      finishedBatchCount++;
      onProgress(results.length + skippedLargeFiles.length);
      if (finishedBatchCount === batches.length) {
        stopAll();
        resolve({ fileSymbols: results, skippedLargeFiles });
      } else {
        sendNextBatch(worker);
      }
    };

    if (batches.length === 0) {
      resolve({ fileSymbols: [], skippedLargeFiles: [] });
      return;
    }
    for (let index = 0; index < workerCount; index++) {
      const worker = new Worker(workerScriptPath, { workerData: options });
      workers.push(worker);
      worker.on('message', (message: ParserWorkerMessage) => handleMessage(worker, message));
      worker.on('error', (error) => {
        if (!isSettled) {
          stopAll();
          reject(error);
        }
      });
      sendNextBatch(worker);
    }
  });
}

export class ScanCancelledError extends Error {
  constructor() {
    super('The scan was cancelled');
    this.name = 'ScanCancelledError';
  }
}
