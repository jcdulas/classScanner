// The floating side panel (spec §4.6): relation toggles, isolation depth and filters,
// in sections that can be folded.

import { useMemo } from 'preact/hooks';
import { ALL_RELATION_KINDS, RelationKind } from '../../shared/graphModel';
import { DiagramController } from '../controller';
import { folderOf } from '../model/groups';
import { readTheme, toCssColor } from '../render/theme';
import { GlassButton, Section, Stepper, ToggleRow } from './controls';
import { ENTITY_KIND_LABELS, RELATION_LABELS } from './labels';
import { FilterList } from './FilterList';
import { useStore } from './useStore';

interface SidePanelProps {
  controller: DiagramController;
}

export function SidePanel({ controller }: SidePanelProps) {
  const store = useStore(controller.store);
  const graph = store.graph;
  const theme = useMemo(() => readTheme(), [graph]);

  const edgeCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_RELATION_KINDS.map((kind) => [kind, 0])) as Record<RelationKind, number>;
    for (const edge of graph?.edges ?? []) {
      counts[edge.kind]++;
    }
    return counts;
  }, [graph]);

  const namespaces = useMemo(() => uniqueSorted(graph?.nodes.map((node) => node.namespace) ?? []), [graph]);
  const folders = useMemo(() => uniqueSorted(graph?.nodes.map((node) => folderOf(graph.files[node.file] ?? '')) ?? []), [graph]);

  const toggleEntityKind = (kind: string) => {
    const hidden = new Set(store.filters.hiddenEntityKinds);
    if (hidden.has(kind)) {
      hidden.delete(kind);
    } else {
      hidden.add(kind);
    }
    store.setFilters({ hiddenEntityKinds: Array.from(hidden) });
  };

  const isolatedName = store.isolation === null ? undefined : store.nodeById.get(store.isolation.nodeId)?.name;

  return (
    <aside class="side-panel glass">
      <Section title="Relations" summary={`${store.activeRelations.size} of ${ALL_RELATION_KINDS.length}`}>
        {ALL_RELATION_KINDS.map((kind) => (
          <ToggleRow key={kind} kind="switch" isOn={store.activeRelations.has(kind)} onToggle={() => store.toggleRelation(kind)}>
            <span class={`swatch line-${kind}`} style={{ borderColor: toCssColor(theme.relationColors[kind]) }} />
            <span class="row-label">{RELATION_LABELS[kind]}</span>
            <span class="count">{edgeCounts[kind]}</span>
          </ToggleRow>
        ))}
      </Section>

      <Section title="Isolation" summary={isolatedName}>
        <div class="inline-setting">
          <span>Neighbor levels</span>
          <Stepper label="Neighbor levels" value={store.isolationDepth} minimum={1} maximum={5} onChange={(depth) => store.setIsolationDepth(depth)} />
        </div>
        {store.isolation === null ? (
          <div class="hint">Right-click a class and choose "Isolate" to show only its neighborhood.</div>
        ) : (
          <GlassButton icon="close" label={`Exit isolation of ${isolatedName}`} title="Show the whole diagram again" onPress={() => store.clearIsolation()} />
        )}
      </Section>

      <Section title="Show">
        {Object.entries(ENTITY_KIND_LABELS).map(([kind, label]) => (
          <ToggleRow key={kind} kind="checkbox" isOn={!store.filters.hiddenEntityKinds.includes(kind)} onToggle={() => toggleEntityKind(kind)}>
            <span class="row-label">{label}</span>
          </ToggleRow>
        ))}
        <ToggleRow kind="checkbox" isOn={store.filters.showExternal} onToggle={() => store.setFilters({ showExternal: !store.filters.showExternal })}>
          <span class="row-label">Forward-declared only</span>
        </ToggleRow>
      </Section>

      <Section title="Namespaces" summary={hiddenSummary(store.filters.hiddenNamespaces.length, namespaces.length)}>
        <FilterList
          items={namespaces}
          hidden={store.filters.hiddenNamespaces}
          separator="::"
          emptyLabel="(global namespace)"
          onChange={(hidden) => store.setFilters({ hiddenNamespaces: hidden })}
        />
      </Section>

      <Section title="Folders" summary={hiddenSummary(store.filters.hiddenFolders.length, folders.length)} isInitiallyOpen={false}>
        <FilterList
          items={folders}
          hidden={store.filters.hiddenFolders}
          separator="/"
          emptyLabel="(scanned folder)"
          onChange={(hidden) => store.setFilters({ hiddenFolders: hidden })}
        />
      </Section>
    </aside>
  );
}

function hiddenSummary(hiddenCount: number, totalCount: number): string {
  return hiddenCount === 0 ? `${totalCount}` : `${totalCount - hiddenCount} of ${totalCount}`;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((first, second) => first.localeCompare(second));
}
