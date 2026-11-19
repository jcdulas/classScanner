// Preact hooks that re-render a component when the store changes.

import { useEffect, useState } from 'preact/hooks';
import { DiagramStore } from '../state/diagramStore';

/**
 * Re-renders on every change except position and camera changes: those happen on every
 * frame while dragging or zooming, and most of the user interface does not display them.
 */
export function useStore(store: DiagramStore): DiagramStore {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      store.subscribe((change) => {
        const onlyMoves = Array.from(change.topics).every((topic) => topic === 'positions' || topic === 'camera');
        if (!onlyMoves) {
          setVersion((version) => version + 1);
        }
      }),
    [store],
  );
  return store;
}

/** The zoom level, updated when the camera stops moving. Undefined before the first diagram. */
export function useCameraScale(store: DiagramStore): number | undefined {
  const [scale, setScale] = useState(store.camera?.scale);
  useEffect(
    () =>
      store.subscribe((change) => {
        if (change.topics.has('camera') || change.topics.has('graph')) {
          setScale(store.camera?.scale);
        }
      }),
    [store],
  );
  return scale;
}
