// Imitates a slow disk, such as a network drive, for the benchmark (spec §8).
//
// Loaded with `node --require`, which also loads it in every worker thread. It adds a wait
// to the file system calls that the scan makes on the files of SLOW_DISK_FOLDER: on a
// network drive each of these calls waits for one round trip to the server, of
// SLOW_DISK_LATENCY_MS milliseconds here.
//
//   - Asynchronous calls (listing the folders) go through 4 slots, like the pool of 4
//     threads that runs them in Node: the fifth call waits for a free slot.
//   - Synchronous calls (reading the files) block their thread for the wait, as they do
//     on a real disk.
//
// Waits poll the clock instead of using timers: on Windows a timer of 5 ms lasts about 15 ms.

const fs = require('node:fs');

const latencyMs = Number(process.env.SLOW_DISK_LATENCY_MS || 0);
const slowFolder = (process.env.SLOW_DISK_FOLDER || '').replace(/\\/g, '/').toLowerCase();

function isOnSlowDisk(target) {
  return typeof target === 'string' && target.replace(/\\/g, '/').toLowerCase().startsWith(slowFolder);
}

function blockFor(milliseconds) {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {
    // Busy wait: the thread is blocked, like in a synchronous call to a slow disk.
  }
}

async function waitFor(milliseconds) {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const POOL_SIZE = 4;
let callsInProgress = 0;
const waitingCalls = [];

/** One asynchronous round trip: waits for a slot of the pool, then for the latency. */
async function asynchronousRoundTrip() {
  if (callsInProgress >= POOL_SIZE) {
    // The call that finishes hands its slot over to this one.
    await new Promise((resolve) => waitingCalls.push(resolve));
  } else {
    callsInProgress++;
  }
  await waitFor(latencyMs);
  const next = waitingCalls.shift();
  if (next !== undefined) {
    next();
  } else {
    callsInProgress--;
  }
}

function slowDownAsynchronousCall(name) {
  const original = fs.promises[name];
  fs.promises[name] = async function (target, ...rest) {
    if (isOnSlowDisk(target)) {
      await asynchronousRoundTrip();
    }
    return original.call(this, target, ...rest);
  };
}

function slowDownFileReads() {
  // Calls on an open file only know its descriptor: the descriptors of slow files are remembered.
  const slowDescriptors = new Set();
  const { openSync, readSync, closeSync } = fs;
  fs.openSync = function (target, ...rest) {
    const descriptor = openSync.call(this, target, ...rest);
    if (isOnSlowDisk(target)) {
      blockFor(latencyMs);
      slowDescriptors.add(descriptor);
    }
    return descriptor;
  };
  fs.readSync = function (descriptor, ...rest) {
    if (slowDescriptors.has(descriptor)) {
      blockFor(latencyMs);
    }
    return readSync.call(this, descriptor, ...rest);
  };
  fs.closeSync = function (descriptor, ...rest) {
    if (slowDescriptors.delete(descriptor)) {
      blockFor(latencyMs);
    }
    return closeSync.call(this, descriptor, ...rest);
  };
}

if (latencyMs > 0 && slowFolder !== '') {
  slowDownAsynchronousCall('readdir');
  slowDownAsynchronousCall('stat');
  slowDownFileReads();
}
