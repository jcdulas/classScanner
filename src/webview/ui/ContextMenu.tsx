// The right-click menu of the diagram (spec §4.3, §4.6).

import { DiagramController } from '../controller';
import { useStore } from './useStore';

interface MenuItem {
  label: string;
  action: () => void;
}

interface ContextMenuProps {
  controller: DiagramController;
}

export function ContextMenu({ controller }: ContextMenuProps) {
  const store = useStore(controller.store);
  const menu = store.contextMenu;
  if (menu === null) {
    return null;
  }

  const items: (MenuItem | 'separator')[] = [];
  const node = menu.nodeId === undefined ? undefined : store.nodeById.get(menu.nodeId);
  if (node !== undefined) {
    // The display mode actions apply to the whole selection, which contains the clicked class.
    const ids = Array.from(store.selection);
    items.push(
      { label: 'Show full', action: () => store.setDisplayMode(ids, 'full') },
      { label: 'Show compact', action: () => store.setDisplayMode(ids, 'compact') },
      { label: 'Follow zoom (auto)', action: () => store.setDisplayMode(ids, 'auto') },
      'separator',
      { label: `Isolate neighborhood (${store.isolationDepth} ${store.isolationDepth === 1 ? 'level' : 'levels'})`, action: () => store.isolate(node.id) },
      { label: 'Go to source', action: () => controller.openSource(node.file, node.line) },
      'separator',
      { label: `Copy schema for an LLM (${ids.length} ${ids.length === 1 ? 'class' : 'classes'})`, action: () => controller.copySelectionAsSchema() },
      { label: 'Export sources as .zip...', action: () => controller.exportSelectionSources() },
    );
    if (store.hasGroupBoxes) {
      const groupKey = store.groupKeyByNode.get(node.id) ?? '';
      items.push('separator', { label: 'Collapse group', action: () => store.toggleGroupCollapsed(groupKey) });
    }
  } else if (menu.groupKey !== undefined) {
    const groupKey = menu.groupKey;
    const label = store.collapsedGroups.has(groupKey) ? 'Expand group' : 'Collapse group';
    items.push({ label, action: () => store.toggleGroupCollapsed(groupKey) });
  } else {
    items.push({ label: 'Fit to view', action: () => controller.fitToView() });
  }
  if (store.isolation !== null) {
    items.push('separator', { label: 'Exit isolation', action: () => store.clearIsolation() });
  }

  return (
    <ul class="context-menu" style={{ left: `${menu.screenX}px`, top: `${menu.screenY}px` }}>
      {items.map((item, index) =>
        item === 'separator' ? (
          <li key={`separator-${index}`} class="menu-separator" />
        ) : (
          <li
            key={item.label}
            onMouseDown={(event) => {
              event.preventDefault();
              store.openContextMenu(null);
              item.action();
            }}
          >
            {item.label}
          </li>
        ),
      )}
    </ul>
  );
}
