// Entry point of the webview.

// PixiJS normally generates some functions at run time with `new Function`,
// which the webview's Content Security Policy forbids. This module replaces
// them with precompiled versions.
import 'pixi.js/unsafe-eval';
import { render } from 'preact';
import { WebviewBootConfig } from '../shared/messages';
import { DiagramController } from './controller';
import { HostConnection } from './hostConnection';
import { LayoutClient } from './layout/layoutClient';
import { editorFontFamily, installCardFonts } from './render/fonts';
import { DiagramStore } from './state/diagramStore';
import { App } from './ui/App';
import './styles.css';

declare global {
  interface Window {
    classScannerBootConfig: WebviewBootConfig;
  }
}

async function main(): Promise<void> {
  const host = new HostConnection();
  try {
    const metrics = installCardFonts(editorFontFamily());
    const layoutClient = await LayoutClient.create(window.classScannerBootConfig.layoutWorkerUrl);
    const store = new DiagramStore(metrics, layoutClient);
    const controller = new DiagramController(store, host, metrics);
    render(<App controller={controller} />, document.getElementById('app')!);
  } catch (error) {
    host.post({ type: 'error', message: `The diagram could not start: ${String(error)}`, stack: (error as Error)?.stack });
    document.getElementById('app')!.textContent = `The diagram could not start: ${String(error)}`;
  }
}

void main();
