// A list of checkboxes shown as a tree, used to filter by namespace or by folder (spec §4.6).
//
// Items are full paths such as `app::core::net` or `src/core/net`. They are
// indented by depth. Unchecking an item hides it and everything below it.

import { useMemo, useState } from 'preact/hooks';

interface FilterListProps {
  items: string[];
  hidden: string[];
  separator: string;
  emptyLabel: string;
  onChange: (hidden: string[]) => void;
}

const MAX_SHOWN_ITEMS = 300;

export function FilterList({ items, hidden, separator, emptyLabel, onChange }: FilterListProps) {
  const [filterText, setFilterText] = useState('');
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const shownItems = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return items.filter((item) => item.toLowerCase().includes(needle)).slice(0, MAX_SHOWN_ITEMS);
  }, [items, filterText]);

  const isBelow = (item: string, parent: string) => item === parent || item.startsWith(parent + separator) || parent === '';

  const toggle = (item: string) => {
    const affected = items.filter((candidate) => (item === '' ? candidate === '' : isBelow(candidate, item)));
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
      {items.length > 10 && (
        <input type="search" placeholder="Filter" value={filterText} onInput={(event) => setFilterText(event.currentTarget.value)} />
      )}
      <div class="filter-actions">
        <button onClick={() => onChange([])}>Show all</button>
        <button onClick={() => onChange([...items])}>Hide all</button>
      </div>
      <ul>
        {shownItems.map((item) => {
          const depth = item === '' ? 0 : item.split(separator).length - 1;
          const label = item === '' ? emptyLabel : item.split(separator).pop();
          return (
            <li key={item} style={{ paddingLeft: `${depth * 12}px` }} title={item || emptyLabel}>
              <label>
                <input type="checkbox" checked={!hiddenSet.has(item)} onChange={() => toggle(item)} />
                {label}
              </label>
            </li>
          );
        })}
      </ul>
      {items.length > shownItems.length && filterText === '' && <div class="hint">Type to filter {items.length} entries.</div>}
    </div>
  );
}
