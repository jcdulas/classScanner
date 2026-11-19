// The collapsible side panel (spec §4.6): relation toggles, isolation depth and filters.

import { useMemo } from 'preact/hooks';
import { ALL_RELATION_KINDS, RelationKind } from '../../shared/graphModel';
import { DiagramController } from '../controller';
import { folderOf } from '../model/groups';
import { readTheme, toCssColor } from '../render/theme';
import { ENTITY_KIND_LABELS, RELATION_LABELS } from './labels';
import { FilterList } from './FilterList';
import { useStore } from './useStore';

interface SidePanelProps {
  controller: DiagramController;
}

export function SidePanel({ controller }: SidePanelProps) {
  const store = useStore(controller.store);
  const graph = store.graph;
  const theme = useMemo(() => readTheme(), [store.graph]);

  const edgeCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_RELATION_KINDS.map((kind) => [kind, 0])) as Record<RelationKind, number>;
    for (const edge of graph?.edges ?? []) {
      counts[edge.kind]++;
    }
    return counts;
  }, [graph]);

  const namespaces = useMemo(() => uniqueSorted(graph?.nodes.map((node) => node.namespace) ?? []), [graph]);
  const folders = useMemo(
    () => uniqueSorted(graph?.nodes.map((node) => folderOf(graph.files[node.file] ?? '')) ?? []),
    [graph],
  );

  const toggleEntityKind = (kind: string) => {
    const hidden = new Set(store.filters.hiddenEntityKinds);
    if (hidden.has(kind)) {
      hidden.delete(kind);
    } else {
      hidden.add(kind);
    }
    store.setFilters({ hiddenEntityKinds: Array.from(hidden) });
  };

  return (
    <aside class="side-panel">
      <section>
        <h3>Relations</h3>
        {ALL_RELATION_KINDS.map((kind) => (
          <label class="relation-toggle" key={kind}>
            <input type="checkbox" checked={store.activeRelations.has(kind)} onChange={() => store.toggleRelation(kind)} />
            <span class={`swatch line-${kind}`} style={{ borderColor: toCssColor(theme.relationColors[kind]) }} />
            {RELATION_LABELS[kind]}
            <span class="count">{edgeCounts[kind]}</span>
          </label>
        ))}
      </section>

      <section>
        <h3>Isolation</h3>
        <label class="slider">
          Neighbors up to {store.isolationDepth} {store.isolationDepth === 1 ? 'level' : 'levels'}
          <input
            type="range"
            min={1}
            max={5}
            value={store.isolationDepth}
            onInput={(event) => store.setIsolationDepth(Number(event.currentTarget.value))}
          />
        </label>
        {store.isolation === null ? (
          <div class="hint">Right-click a class and choose "Isolate" to show only its neighborhood.</div>
        ) : (
          <button onClick={() => store.clearIsolation()}>Exit isolation of {store.nodeById.get(store.isolation.nodeId)?.name}</button>
        )}
      </section>

      <section>
        <h3>Show</h3>
        {Object.entries(ENTITY_KIND_LABELS).map(([kind, label]) => (
          <label key={kind}>
            <input type="checkbox" checked={!store.filters.hiddenEntityKinds.includes(kind)} onChange={() => toggleEntityKind(kind)} />
            {label}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={store.filters.showExternal}
            onChange={() => store.setFilters({ showExternal: !store.filters.showExternal })}
          />
          Forward-declared only
        </label>
      </section>

      <section>
        <h3>Namespaces</h3>
        <FilterList
          items={namespaces}
          hidden={store.filters.hiddenNamespaces}
          separator="::"
          emptyLabel="(global namespace)"
          onChange={(hidden) => store.setFilters({ hiddenNamespaces: hidden })}
        />
      </section>

      <section>
        <h3>Folders</h3>
        <FilterList
          items={folders}
          hidden={store.filters.hiddenFolders}
          separator="/"
          emptyLabel="(scanned folder)"
          onChange={(hidden) => store.setFilters({ hiddenFolders: hidden })}
        />
      </section>
    </aside>
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((first, second) => first.localeCompare(second));
}
