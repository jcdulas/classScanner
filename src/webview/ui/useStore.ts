// A Preact hook that re-renders a component when the store changes.
//
// Position and camera changes are ignored: they happen on every frame while
// dragging or zooming, and no part of the user interface displays them.

import { useEffect, useState } from 'preact/hooks';
import { DiagramStore } from '../state/diagramStore';

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
