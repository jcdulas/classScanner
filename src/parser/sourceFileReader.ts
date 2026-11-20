// Reads the text of a source file, unless it is above the size limit (spec §2.2).
//
// The calls are synchronous on purpose (spec §2.3). Asynchronous file calls of
// Node all go through one pool of 4 threads, shared by every worker thread of
// the process: on a network drive, where each call waits for the server, 8
// parser workers would wait behind these 4 threads. A synchronous call blocks
// only the worker that makes it, so every worker waits for its own file.
// On a simulated network drive (`npm run benchmark -- --latency 10`: 2000 files, 10 ms per
// call, 8 workers): 16 s to read and parse with asynchronous calls, 8 s with
// synchronous calls.
//
// The size is read from the open file, which costs no extra round trip to the
// server, instead of asking for it while listing the folders.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Returns the text of the file, or `undefined` when the file is larger than `maxFileSizeBytes`. */
export function readSourceFile(absolutePath: string, maxFileSizeBytes: number): string | undefined {
  const descriptor = openSync(absolutePath, 'r');
  try {
    const size = fstatSync(descriptor).size;
    if (size > maxFileSizeBytes) {
      return undefined;
    }
    const buffer = Buffer.allocUnsafe(size);
    let bytesRead = 0;
    while (bytesRead < size) {
      const count = readSync(descriptor, buffer, bytesRead, size - bytesRead, bytesRead);
      if (count === 0) {
        break; // The file became shorter since its size was read.
      }
      bytesRead += count;
    }
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}
