// Starts the layout web worker and turns its messages into promises.
//
// A VS Code webview cannot start a worker directly from the extension's files,
// because they are served from another origin. The script is fetched as text
// and the worker is started from a `blob:` URL instead, which the Content
// Security Policy of the webview allows (see src/extension/webviewHtml.ts).

import { LayoutInput, LayoutPositions, LayoutRequestMessage, LayoutResponseMessage, PackingInput } from './layoutTypes';

export interface LayoutResult {
  positions: LayoutPositions;
  durationMs: number;
}

export class LayoutClient {
  private nextRequestId = 1;
  private readonly pending = new Map<number, { resolve: (result: LayoutResult) => void; reject: (error: Error) => void }>();

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<LayoutResponseMessage>) => this.handleResponse(event.data);
  }

  static async create(workerScriptUrl: string): Promise<LayoutClient> {
    const response = await fetch(workerScriptUrl);
    const scriptText = await response.text();
    const blobUrl = URL.createObjectURL(new Blob([scriptText], { type: 'text/javascript' }));
    return new LayoutClient(new Worker(blobUrl));
  }

  compute(input: LayoutInput): Promise<LayoutResult> {
    return this.send((requestId) => ({ requestId, input }));
  }

  /** Places group boxes next to each other; returns the top-left corner of each box. */
  async pack(packing: PackingInput): Promise<LayoutPositions> {
    const result = await this.send((requestId) => ({ requestId, packing }));
    return result.positions;
  }

  private send(buildMessage: (requestId: number) => LayoutRequestMessage): Promise<LayoutResult> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage(buildMessage(requestId));
    });
  }

  private handleResponse(response: LayoutResponseMessage): void {
    const request = this.pending.get(response.requestId);
    if (request === undefined) {
      return;
    }
    this.pending.delete(response.requestId);
    if ('error' in response) {
      request.reject(new Error(response.error));
    } else {
      request.resolve({ positions: response.positions, durationMs: response.durationMs });
    }
  }
}
