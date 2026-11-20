// The right-click menu of the diagram (spec §4.3, §4.6).

import { DiagramController } from '../controller';
import { openTargetsOf } from '../model/openTargets';
import { Icon, IconName } from './Icon';
import { useStore } from './useStore';

interface MenuItem {
  label: string;
  icon: IconName;
  action: () => void;
}

const MENU_WIDTH = 270;

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
  if (node !== undefined && store.graph !== undefined) {
    const member = menu.member;
    // The display mode actions apply to the whole selection, which contains the clicked class.
    const ids = Array.from(store.selection);
    const classes = `${ids.length} ${ids.length === 1 ? 'class' : 'classes'}`;
    items.push(
      { label: 'Show full', icon: 'full', action: () => store.setDisplayMode(ids, 'full') },
      { label: 'Show compact', icon: 'compact', action: () => store.setDisplayMode(ids, 'compact') },
      { label: 'Follow zoom (auto)', icon: 'auto', action: () => store.setDisplayMode(ids, 'auto') },
      'separator',
      {
        label: `Isolate neighborhood (${store.isolationDepth} ${store.isolationDepth === 1 ? 'level' : 'levels'})`,
        icon: 'isolate',
        action: () => store.isolate(node.id),
      },
      'separator',
    );
    // One entry per file of the class: its header, and its source file when there is one.
    for (const target of openTargetsOf(node, store.graph.files)) {
      const icon = target.isHeader ? 'header' : 'code';
      items.push({ label: `Open ${target.fileName}`, icon, action: () => controller.openSource(target.file, target.line) });
    }
    if (member !== undefined) {
      items.push({ label: `Go to ${member.name}`, icon: 'code', action: () => controller.openSource(member.file, member.line) });
    }
    items.push(
      'separator',
      { label: `Copy schema for an LLM (${classes})`, icon: 'copy', action: () => controller.copySelectionAsSchema() },
      { label: `Export sources as .zip (${classes})`, icon: 'archive', action: () => controller.exportSelectionSources() },
    );
    if (store.hasGroupBoxes) {
      const groupKey = store.groupKeyByNode.get(node.id) ?? '';
      items.push('separator', { label: 'Collapse group', icon: 'collapse', action: () => void store.toggleGroupCollapsed(groupKey) });
    }
  } else if (menu.groupKey !== undefined) {
    const groupKey = menu.groupKey;
    const label = store.collapsedGroups.has(groupKey) ? 'Expand group' : 'Collapse group';
    items.push({ label, icon: 'collapse', action: () => void store.toggleGroupCollapsed(groupKey) });
  } else {
    items.push({ label: 'Fit to view', icon: 'fit', action: () => controller.fitToView() });
  }
  if (store.isolation !== null) {
    items.push('separator', { label: 'Exit isolation', icon: 'close', action: () => store.clearIsolation() });
  }

  // Keeps the menu inside the view when the click is near the right or bottom edge.
  const estimatedHeight = items.reduce((height, item) => height + (item === 'separator' ? 11 : 31), 14);
  const left = Math.max(8, Math.min(menu.screenX, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(menu.screenY, window.innerHeight - estimatedHeight - 8));

  return (
    <div role="menu" class="context-menu popover glass" style={{ left: `${left}px`, top: `${top}px`, width: `${MENU_WIDTH}px` }}>
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`separator-${index}`} class="menu-separator" />
        ) : (
          <div
            key={item.label}
            role="menuitem"
            class="menu-item"
            onMouseDown={(event) => {
              event.preventDefault();
              store.openContextMenu(null);
              item.action();
            }}
          >
            <span class="menu-check">
              <Icon name={item.icon} size={14} />
            </span>
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}
