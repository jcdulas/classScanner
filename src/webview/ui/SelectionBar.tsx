// The bar that appears at the bottom of the diagram while classes are selected.
// It gathers the actions that apply to the selection, so they are one click
// away instead of hidden in the context menu.

import { DisplayMode } from '../../shared/savedState';
import { DiagramController } from '../controller';
import { GlassButton, Segmented, SegmentOption } from './controls';
import { SchemaButton } from './SchemaButton';
import { useStore } from './useStore';

const DISPLAY_OPTIONS: SegmentOption[] = [
  { value: 'auto', label: 'Auto', icon: 'auto', title: 'The selected cards follow the zoom level' },
  { value: 'compact', label: 'Compact', icon: 'compact', title: 'The selected cards show only their name' },
  { value: 'full', label: 'Full', icon: 'full', title: 'The selected cards show all their members' },
];

interface SelectionBarProps {
  controller: DiagramController;
}

export function SelectionBar({ controller }: SelectionBarProps) {
  const store = useStore(controller.store);
  const ids = Array.from(store.selection);
  if (ids.length === 0) {
    return null;
  }
  const modes = new Set(ids.map((id) => store.displayModeOf(id)));
  const commonMode = modes.size === 1 ? Array.from(modes)[0] : undefined;
  const single = ids.length === 1 ? store.nodeById.get(ids[0]) : undefined;

  return (
    <div class="selection-bar glass bar">
      <span class="selection-count">{single !== undefined ? single.name : `${ids.length} classes`}</span>
      <span class="bar-divider" />
      <Segmented options={DISPLAY_OPTIONS} value={commonMode} onChange={(mode) => store.setDisplayMode(ids, mode as DisplayMode)} />
      <span class="bar-divider" />
      {single !== undefined && (
        <>
          <GlassButton icon="isolate" label="Isolate" title="Show only this class and its neighbors" onPress={() => store.isolate(single.id)} />
          <GlassButton icon="code" label="Source" title="Open the declaration" onPress={() => controller.openSource(single.file, single.line)} />
        </>
      )}
      <SchemaButton controller={controller} />
      <GlassButton icon="archive" label="Sources" title="Save the source files of the selection in a .zip archive" onPress={() => controller.exportSelectionSources()} />
      <GlassButton icon="close" title="Clear the selection (Escape)" onPress={() => store.clearSelection()} />
    </div>
  );
}
