// Entry point of the layout web worker.
//
// Computing a layout of 1500 cards takes from a few hundred milliseconds to
// a few seconds. Running it in a web worker keeps the diagram responsive
// meanwhile (spec §8). The worker receives a LayoutRequestMessage and answers
// with a LayoutResponseMessage.

import { computeLayout } from './computeLayout';
import { LayoutRequestMessage, LayoutResponseMessage } from './layoutTypes';

self.onmessage = async (event: MessageEvent<LayoutRequestMessage>) => {
  const { requestId, input } = event.data;
  const startTime = performance.now();
  let response: LayoutResponseMessage;
  try {
    const positions = await computeLayout(input);
    response = { requestId, positions, durationMs: performance.now() - startTime };
  } catch (error) {
    response = { requestId, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
