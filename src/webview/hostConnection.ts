// The link between the webview and the extension host.
//
// `acquireVsCodeApi` is provided by VS Code inside webviews. It can be called
// only once; it gives `postMessage`, to send messages to the extension host,
// and `setState`, to keep a small state that VS Code restores when the panel
// is reopened after a restart.

import { WebviewToHostMessage } from '../shared/messages';

interface VsCodeApi {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export class HostConnection {
  private readonly api = acquireVsCodeApi();

  post(message: WebviewToHostMessage): void {
    this.api.postMessage(message);
  }

  /** Remembered by VS Code to rescan the same folder when the panel is restored. */
  rememberScanTarget(folder: string, depth: number): void {
    this.api.setState({ folder, depth });
  }
}
