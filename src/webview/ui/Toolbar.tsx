// The toolbar at the top of the diagram.

import { ALL_LAYOUT_KINDS, GroupingKind, LayoutKind } from '../../shared/savedState';
import { DiagramController } from '../controller';
import { GROUPING_LABELS, LAYOUT_LABELS } from './labels';
import { SearchBox } from './SearchBox';
import { useStore } from './useStore';

const GROUPING_KINDS: GroupingKind[] = ['namespace', 'folder', 'file', 'none'];

interface ToolbarProps {
  controller: DiagramController;
}

export function Toolbar({ controller }: ToolbarProps) {
  const store = useStore(controller.store);
  const isBusy = store.phase === 'scanning' || store.phase === 'layouting';

  return (
    <div class="toolbar">
      <button title="Show or hide the side panel" onClick={() => store.toggleSidePanel()}>
        ☰
      </button>
      <SearchBox controller={controller} />
      <span class="separator" />
      <label>
        Layout
        <select
          value={store.layout}
          disabled={isBusy}
          onChange={(event) => void store.setLayout(event.currentTarget.value as LayoutKind)}
        >
          {ALL_LAYOUT_KINDS.map((kind) => (
            <option value={kind}>{LAYOUT_LABELS[kind]}</option>
          ))}
        </select>
      </label>
      <label>
        Group by
        <select
          value={store.grouping}
          disabled={isBusy}
          onChange={(event) => void store.setGrouping(event.currentTarget.value as GroupingKind)}
        >
          {GROUPING_KINDS.map((kind) => (
            <option value={kind}>{GROUPING_LABELS[kind]}</option>
          ))}
        </select>
      </label>
      <button disabled={isBusy} title="Compute the layout again: reclaims free space and discards manual moves in this layout" onClick={() => void store.computeLayout(true)}>
        Recompute layout
      </button>
      <span class="separator" />
      <span class="button-group" title="Display mode of every class">
        <button onClick={() => store.setAllDisplayModes('auto')} title="Every card follows the zoom level">
          Auto
        </button>
        <button onClick={() => store.setAllDisplayModes('compact')} title="Show only class names">
          All compact
        </button>
        <button onClick={() => store.setAllDisplayModes('full')} title="Show every member">
          All full
        </button>
      </span>
      <span class="separator" />
      <button title="Zoom out" onClick={() => controller.zoomBy(1 / 1.4)}>
        −
      </button>
      <button title="Zoom in" onClick={() => controller.zoomBy(1.4)}>
        +
      </button>
      <button title="Show the whole diagram" onClick={() => controller.fitToView()}>
        Fit
      </button>
      <span class="spacer" />
      <button disabled={isBusy} title="Scan the folder again" onClick={() => controller.rescan()}>
        Rescan
      </button>
      <button disabled={store.graph === undefined} title="Export as PNG or SVG" onClick={() => controller.startExport()}>
        Export
      </button>
    </div>
  );
}
