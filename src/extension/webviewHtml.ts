// Builds the HTML page of the diagram webview.
//
// VS Code webviews are sandboxed pages: they can only load files from the
// folders listed in `localResourceRoots`, through special URLs created with
// `webview.asWebviewUri`. The Content Security Policy only allows our own
// script (identified by a random nonce), our own styles, and web workers
// created from `blob:` URLs, which is how the layout worker is started (see
// src/webview/layout/layoutClient.ts).

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { WebviewBootConfig } from '../shared/messages';

export function buildWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const webviewFolder = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, 'main.css'));
  const bootConfig: WebviewBootConfig = {
    layoutWorkerUrl: webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, 'layoutWorker.js')).toString(),
  };
  const nonce = randomBytes(16).toString('base64');
  const source = webview.cspSource;
  const contentSecurityPolicy = [
    "default-src 'none'",
    `img-src ${source} blob: data:`,
    `style-src ${source} 'unsafe-inline'`,
    `font-src ${source}`,
    `script-src 'nonce-${nonce}'`,
    'worker-src blob:',
    `connect-src ${source}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>classScanner</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.classScannerBootConfig = ${JSON.stringify(bootConfig)};</script>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
