// The root component of the webview user interface.
//
// The WebGL canvas lives in `diagram-host`; the user interface (toolbar, side
// panel, menus) is regular HTML around and above it.

import { useEffect, useRef } from 'preact/hooks';
import { DiagramController } from '../controller';
import { ContextMenu } from './ContextMenu';
import { SidePanel } from './SidePanel';
import { PhaseOverlay, StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
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

  // Escape closes the menu, then clears the selection, then leaves the isolation mode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement) {
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
    <div class="app">
      <Toolbar controller={controller} />
      <div class="main">
        {store.isSidePanelOpen && <SidePanel controller={controller} />}
        <div class="diagram-area">
          <div class="diagram-host" ref={hostRef} />
          <ContextMenu controller={controller} />
          <PhaseOverlay controller={controller} />
          <StatusBar controller={controller} />
        </div>
      </div>
    </div>
  );
}
