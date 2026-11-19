// A list of check boxes shown as a tree, used to filter by namespace or by folder (spec §4.6).
//
// Items are full paths such as `app::core::net` or `src/core/net`. An item is
// indented under its closest ancestor present in the list, and shows only the
// part of its path below that ancestor. Unchecking an item hides it and
// everything below it.

import { useMemo, useState } from 'preact/hooks';
import { GlassButton, ToggleRow } from './controls';
import { Icon } from './Icon';

interface FilterListProps {
  items: string[];
  hidden: string[];
  separator: string;
  emptyLabel: string;
  onChange: (hidden: string[]) => void;
}

interface TreeRow {
  item: string;
  label: string;
  depth: number;
}

const MAX_SHOWN_ITEMS = 300;

export function FilterList({ items, hidden, separator, emptyLabel, onChange }: FilterListProps) {
  const [filterText, setFilterText] = useState('');
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const rows = useMemo(() => buildTreeRows(items, separator, emptyLabel), [items, separator, emptyLabel]);
  const shownRows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return rows.filter((row) => row.item.toLowerCase().includes(needle)).slice(0, MAX_SHOWN_ITEMS);
  }, [rows, filterText]);

  const toggle = (item: string) => {
    const affected = items.filter((candidate) => candidate === item || (item !== '' && candidate.startsWith(item + separator)));
    const willHide = !hiddenSet.has(item);
    const next = new Set(hiddenSet);
    for (const candidate of affected) {
      if (willHide) {
        next.add(candidate);
      } else {
        next.delete(candidate);
      }
    }
    onChange(Array.from(next));
  };

  return (
    <div class="filter-list">
      <div class="filter-actions">
        {items.length > 8 && (
          <div class="search-field small">
            <Icon name="search" size={13} />
            <input type="text" spellcheck={false} placeholder="Filter" value={filterText} onInput={(event) => setFilterText(event.currentTarget.value)} />
          </div>
        )}
        <span class="spacer" />
        <GlassButton label="All" title="Show all" onPress={() => onChange([])} />
        <GlassButton label="None" title="Hide all" onPress={() => onChange([...items])} />
      </div>
      <div class="filter-rows">
        {shownRows.map((row) => (
          <ToggleRow key={row.item} kind="checkbox" isOn={!hiddenSet.has(row.item)} onToggle={() => toggle(row.item)} title={row.item || emptyLabel} indent={row.depth}>
            <span class="row-label">{row.label}</span>
          </ToggleRow>
        ))}
      </div>
      {rows.length > shownRows.length && filterText === '' && <div class="hint">Type to filter {rows.length} entries.</div>}
    </div>
  );
}

/** Computes the indentation and the short label of each item from the other items of the list. */
function buildTreeRows(items: string[], separator: string, emptyLabel: string): TreeRow[] {
  const present = new Set(items);
  return items.map((item) => {
    if (item === '') {
      return { item, label: emptyLabel, depth: 0 };
    }
    const parts = item.split(separator);
    let depth = 0;
    let closestAncestorLength = 0;
    for (let length = 1; length < parts.length; length++) {
      if (present.has(parts.slice(0, length).join(separator))) {
        depth++;
        closestAncestorLength = length;
      }
    }
    return { item, label: parts.slice(closestAncestorLength).join(separator), depth };
  });
}
