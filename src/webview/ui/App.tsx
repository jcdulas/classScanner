// The root component of the webview user interface.
//
// The WebGL canvas fills the whole webview (`diagram-host`). The user
// interface floats above it as glass panels: bars at the top, the side panel
// on the left, the selection bar and status at the bottom, and on the right the
// panel of the interface of the selection or the analysis panel.

import { useEffect, useRef } from 'preact/hooks';
import { DiagramController } from '../controller';
import { AnalysisPanel } from './AnalysisPanel';
import { ContextMenu } from './ContextMenu';
import { InterfacePanel } from './InterfacePanel';
import { SelectionBar } from './SelectionBar';
import { SidePanel } from './SidePanel';
import { PhaseOverlay, StatusPill, ZoomControls } from './StatusBar';
import { TopBar } from './TopBar';
import { useStore } from './useStore';

interface AppProps {
  controller: DiagramController;
}

export function App({ controller }: AppProps) {
  const store = useStore(controller.store);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hostRef.current !== null) {
      void controller.attachRenderer(hostRef.current);
    }
  }, [controller]);

  // Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on macOS).
  // Escape closes the menu, then clears the selection, then leaves the isolation mode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }
      if (event.key !== 'Escape') {
        return;
      }
      if (store.contextMenu !== null) {
        store.openContextMenu(null);
      } else if (store.selection.size > 0) {
        store.clearSelection();
      } else {
        store.clearIsolation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  return (
    <div class={`app ${store.isSidePanelOpen ? 'panel-open' : ''}`}>
      <div class="diagram-host" ref={hostRef} />
      <PhaseOverlay controller={controller} />
      <TopBar controller={controller} />
      {store.isSidePanelOpen && <SidePanel controller={controller} />}
      <StatusPill controller={controller} />
      <SelectionBar controller={controller} />
      <InterfacePanel controller={controller} />
      <AnalysisPanel controller={controller} />
      <ZoomControls controller={controller} />
      <ContextMenu controller={controller} />
    </div>
  );
}
