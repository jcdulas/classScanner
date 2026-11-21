// The floating bars at the top of the diagram: search on the left, layout and
// display in the middle, analysis, scan and export on the right.

import { DisplayMode, GroupingKind, LayoutKind } from '../../shared/savedState';
import { DiagramController } from '../controller';
import { DiagramStore } from '../state/diagramStore';
import { Dropdown, GlassButton, Segmented, SegmentOption } from './controls';
import { GROUPING_LABELS, LAYOUT_LABELS } from './labels';
import { SearchBox } from './SearchBox';
import { useStore } from './useStore';

const LAYOUT_OPTIONS: SegmentOption[] = [
  { value: 'grouped', label: LAYOUT_LABELS.grouped, icon: 'grouped', title: 'Classes in group boxes, layered inside each group' },
  { value: 'hierarchy', label: LAYOUT_LABELS.hierarchy, icon: 'hierarchy', title: 'One inheritance hierarchy, base classes at the top' },
  { value: 'organic', label: LAYOUT_LABELS.organic, icon: 'organic', title: 'Linked classes pulled close together' },
];

const GROUPING_OPTIONS = (['namespace', 'folder', 'file', 'none'] as GroupingKind[]).map((kind) => ({
  value: kind,
  label: GROUPING_LABELS[kind],
}));

const DISPLAY_OPTIONS: SegmentOption[] = [
  { value: 'auto', label: 'Auto', icon: 'auto', title: 'Every card follows the zoom level' },
  { value: 'compact', label: 'Compact', icon: 'compact', title: 'Every card shows only its name' },
  { value: 'full', label: 'Full', icon: 'full', title: 'Every card shows all its members' },
];

interface TopBarProps {
  controller: DiagramController;
}

export function TopBar({ controller }: TopBarProps) {
  const store = useStore(controller.store);
  const isBusy = store.phase === 'scanning' || store.phase === 'layouting';
  const hasGraph = store.graph !== undefined;

  return (
    <div class="top-bar">
      <div class="glass bar">
        <GlassButton icon="sidebar" title="Show or hide the panel" isActive={store.isSidePanelOpen} onPress={() => store.toggleSidePanel()} />
        <SearchBox controller={controller} />
        <span class="bar-divider" />
        <GlassButton icon="undo" title="Undo the last change of the arrangement (Ctrl+Z)" isDisabled={!store.canUndo} onPress={() => store.undo()} />
        <GlassButton icon="redo" title="Redo (Ctrl+Y)" isDisabled={!store.canRedo} onPress={() => store.redo()} />
      </div>

      <div class="glass bar">
        <Segmented options={LAYOUT_OPTIONS} value={store.layout} isDisabled={isBusy} onChange={(value) => void store.setLayout(value as LayoutKind)} />
        <Dropdown
          caption="Group by"
          options={GROUPING_OPTIONS}
          value={store.grouping}
          isDisabled={isBusy}
          onChange={(value) => void store.setGrouping(value as GroupingKind)}
        />
        <GlassButton
          icon="relayout"
          title="Recompute the layout: reclaims free space and discards manual moves in this layout"
          isDisabled={isBusy || !hasGraph}
          onPress={() => void store.recomputeLayout()}
        />
        <span class="bar-divider" />
        <Segmented options={DISPLAY_OPTIONS} value={commonDisplayMode(store)} onChange={(value) => void store.setAllDisplayModes(value as DisplayMode)} />
      </div>

      <div class="glass bar">
        <GlassButton
          icon="analysis"
          title="Analysis: cycles of uses, path between two classes, most used and unused classes, classes changed since a git branch"
          isActive={store.isAnalysisPanelOpen}
          isDisabled={!hasGraph}
          onPress={() => store.toggleAnalysisPanel()}
        />
        <GlassButton icon="rescan" label="Rescan" title="Scan the folder again" isDisabled={isBusy} onPress={() => controller.rescan()} />
        <GlassButton icon="export" label="Export" title="Export images, a schema or sources" variant="accent" isDisabled={!hasGraph} onPress={() => controller.startExport()} />
      </div>
    </div>
  );
}

/** The display mode shared by every class, or undefined when classes have different modes. */
function commonDisplayMode(store: DiagramStore): DisplayMode | undefined {
  if (store.displayModes.size === 0) {
    return 'auto';
  }
  const nodeCount = store.graph?.nodes.length ?? 0;
  if (store.displayModes.size < nodeCount) {
    return undefined;
  }
  const modes = new Set(store.displayModes.values());
  return modes.size === 1 ? Array.from(modes)[0] : undefined;
}
