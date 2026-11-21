// The four lists of the analysis panel (spec §4.9, AnalysisPanel.tsx). Every
// row does something: a class row selects the class and shows it in the
// diagram, a link row opens the line of the sources that creates the link.

import { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Graph } from '../../shared/graphModel';
import { DiagramController } from '../controller';
import { groupLabel } from '../model/groups';
import { UsageAnalysis, classesAlong, findUsagePath } from '../model/usageAnalysis';
import { UsageCycle } from '../model/usageCycles';
import { UsageLink } from '../model/usageLinks';
import { GlassButton, PressableRow } from './controls';
import { Icon } from './Icon';
import { GROUPING_LABELS, interfaceUseLabel } from './labels';
import { useStore } from './useStore';

/** A list shows this many entries at most: beyond it, the first ones are the ones that matter. */
const MAX_SHOWN_CYCLES = 50;
const MAX_SHOWN_CLASSES = 100;
const MAX_MOST_USED = 30;

interface UsageTabProps {
  analysis: UsageAnalysis;
  graph: Graph;
  controller: DiagramController;
}

// ---- Cycles ----

export function CyclesTab({ analysis, graph, controller }: UsageTabProps) {
  const store = useStore(controller.store);
  const classCycles = analysis.classCycles;
  const groupCycles = store.grouping === 'none' ? [] : analysis.groupCycles;
  const classNameOf = (id: string) => store.nodeById.get(id)?.name ?? id;
  const groupNameOf = (key: string) => groupLabel(key, store.grouping);
  // To show a cycle of groups, the classes of its groups are selected.
  const classesOfGroups = (groupKeys: string[]) => graph.nodes.filter((node) => groupKeys.includes(store.groupKeyByNode.get(node.id) ?? '')).map((node) => node.id);

  if (classCycles.length === 0 && groupCycles.length === 0) {
    return <div class="hint">No cycle: no class uses, directly or through others, a class that uses it.</div>;
  }
  return (
    <div class="interface-list">
      <ListHeading>
        {countOf(classCycles.length, 'cycle', 'cycles')} between classes
        {classCycles.length > MAX_SHOWN_CYCLES ? `, the ${MAX_SHOWN_CYCLES} largest shown` : ''}
      </ListHeading>
      {classCycles.slice(0, MAX_SHOWN_CYCLES).map((cycle) => (
        <CycleSection
          key={`class|${cycle.ids[0]}`}
          cycle={cycle}
          unit="classes"
          nameOf={classNameOf}
          files={graph.files}
          controller={controller}
          onShow={() => void controller.showClasses(cycle.ids)}
        />
      ))}
      {store.grouping !== 'none' && (
        <ListHeading>
          {countOf(groupCycles.length, 'cycle', 'cycles')} between groups ({GROUPING_LABELS[store.grouping].toLowerCase()})
        </ListHeading>
      )}
      {groupCycles.slice(0, MAX_SHOWN_CYCLES).map((cycle) => (
        <CycleSection
          key={`group|${cycle.ids[0]}`}
          cycle={cycle}
          unit="groups"
          nameOf={groupNameOf}
          files={graph.files}
          controller={controller}
          onShow={() => void controller.showClasses(classesOfGroups(cycle.ids))}
        />
      ))}
    </div>
  );
}

interface CycleSectionProps {
  cycle: UsageCycle;
  unit: 'classes' | 'groups';
  nameOf: (id: string) => string;
  files: string[];
  controller: DiagramController;
  onShow: () => void;
}

/** One cycle: its members, and under them a short circle of uses among them as an example. */
function CycleSection({ cycle, unit, nameOf, files, controller, onShow }: CycleSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const names = cycle.ids.map(nameOf).join(', ');
  return (
    <div class="interface-class">
      <div class="interface-class-header">
        <PressableRow className="interface-class-name" title={cycle.ids.join('\n')} isExpanded={isOpen} onPress={() => setIsOpen(!isOpen)}>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} />
          <span class="row-label">{names}</span>
          <span class="count">{cycle.ids.length}</span>
        </PressableRow>
        <GlassButton icon="locate" title={`Select the ${cycle.ids.length} ${unit} of this cycle and show them in the diagram`} onPress={onShow} />
      </div>
      {isOpen && cycle.example.map((link) => <LinkRow key={`${link.from}|${link.to}`} link={link} nameOf={nameOf} files={files} controller={controller} />)}
      {isOpen && cycle.example.length < cycle.ids.length && <div class="hint analysis-indented">A short circle among them, as an example.</div>}
    </div>
  );
}

// ---- Path ----

export function PathTab({ analysis, graph, controller }: UsageTabProps) {
  const store = useStore(controller.store);
  // The two ends are remembered, so that the path stays listed while its classes are selected.
  const [ends, setEnds] = useState<string[]>([]);
  const selectedIds = Array.from(store.selection);
  useEffect(() => {
    if (selectedIds.length === 2 && (selectedIds[0] !== ends[0] || selectedIds[1] !== ends[1])) {
      setEnds(selectedIds);
    }
  }, [store.selection]);

  const [firstId, secondId] = ends;
  const hasEnds = ends.length === 2 && store.nodeById.has(firstId) && store.nodeById.has(secondId);
  const forward = useMemo(() => (hasEnds ? findUsagePath(analysis, firstId, secondId) : undefined), [analysis, firstId, secondId, hasEnds]);
  const backward = useMemo(() => (hasEnds ? findUsagePath(analysis, secondId, firstId) : undefined), [analysis, firstId, secondId, hasEnds]);
  if (!hasEnds) {
    return <div class="hint">Select two classes (Ctrl + click the second one) to see how each one reaches the other through what it uses.</div>;
  }
  const nameOf = (id: string) => store.nodeById.get(id)?.name ?? id;
  return (
    <div class="interface-list">
      <PathSection fromId={firstId} toId={secondId} path={forward} nameOf={nameOf} files={graph.files} controller={controller} />
      <PathSection fromId={secondId} toId={firstId} path={backward} nameOf={nameOf} files={graph.files} controller={controller} />
    </div>
  );
}

interface PathSectionProps {
  fromId: string;
  toId: string;
  path: UsageLink[] | undefined;
  nameOf: (id: string) => string;
  files: string[];
  controller: DiagramController;
}

/** The shortest chain of uses from a class to another one, one row per link. */
function PathSection({ fromId, toId, path, nameOf, files, controller }: PathSectionProps) {
  if (path === undefined) {
    return (
      <ListHeading>
        {nameOf(fromId)} does not use {nameOf(toId)}, even through other classes
      </ListHeading>
    );
  }
  const classIds = classesAlong(path);
  return (
    <div class="interface-class">
      <div class="interface-class-header">
        <span class="analysis-heading">
          {nameOf(fromId)} reaches {nameOf(toId)} in {countOf(path.length, 'step', 'steps')}
        </span>
        <GlassButton icon="locate" title={`Select the ${classIds.length} classes of this path and show them in the diagram`} onPress={() => void controller.showClasses(classIds)} />
      </div>
      {path.map((link) => (
        <LinkRow key={`${link.from}|${link.to}`} link={link} nameOf={nameOf} files={files} controller={controller} />
      ))}
    </div>
  );
}

// ---- Usage ----

export function UsageTab({ analysis, controller }: UsageTabProps) {
  const store = useStore(controller.store);
  const { mostUsed, unusedIds } = analysis.ranking;
  return (
    <div class="interface-list">
      <ListHeading>Most used classes</ListHeading>
      {mostUsed.slice(0, MAX_MOST_USED).map((usage) => (
        <ClassRow
          key={usage.id}
          id={usage.id}
          name={store.nodeById.get(usage.id)?.name ?? usage.id}
          count={usage.userCount}
          title={`Used by ${countOf(usage.userCount, 'class', 'classes')}, uses ${countOf(usage.usedCount, 'class', 'classes')}`}
          controller={controller}
        />
      ))}
      {mostUsed.length === 0 && <div class="hint">No class uses another one.</div>}
      <ListHeading>{countOf(unusedIds.length, 'class', 'classes')} that nothing uses</ListHeading>
      {unusedIds.length > 0 && (
        <div class="hint">No class and no free function of the scanned code uses them. They may be used from outside the scanned folder.</div>
      )}
      <ClassRows ids={unusedIds} controller={controller} />
    </div>
  );
}

// ---- Changes ----

interface ChangesTabProps {
  controller: DiagramController;
}

export function ChangesTab({ controller }: ChangesTabProps) {
  const store = useStore(controller.store);
  const changes = store.changes;
  return (
    <div class="interface-list">
      <div class="analysis-actions">
        <GlassButton label="Compare with…" title="Choose the last commit or a branch to compare the sources with" onPress={() => controller.requestChanges()} />
        {changes !== undefined && changes.classIds.length > 0 && (
          <GlassButton
            icon="locate"
            label="Select all"
            title="Select the changed classes and show them in the diagram: their interface tells what the change touches"
            onPress={() => void controller.showClasses(changes.classIds)}
          />
        )}
      </div>
      {store.changesFailure !== '' && <div class="hint">The changes could not be read: {store.changesFailure}</div>}
      {changes === undefined ? (
        <div class="hint">Lists the classes whose lines changed since the last commit, or since the current work left a branch: what a review has to look at.</div>
      ) : (
        <ListHeading>
          {countOf(changes.classIds.length, 'class', 'classes')} changed in {countOf(changes.changedFileCount, 'file', 'files')} since{' '}
          {changes.reference === 'HEAD' ? 'the last commit' : changes.reference}
        </ListHeading>
      )}
      <ClassRows ids={changes?.classIds ?? []} controller={controller} />
    </div>
  );
}

// ---- Rows shared by the lists ----

function ListHeading({ children }: { children: ComponentChildren }) {
  return <div class="analysis-heading">{children}</div>;
}

interface ClassRowsProps {
  ids: string[];
  controller: DiagramController;
}

/** A plain list of classes, cut after MAX_SHOWN_CLASSES. */
function ClassRows({ ids, controller }: ClassRowsProps) {
  const store = controller.store;
  return (
    <>
      {ids.slice(0, MAX_SHOWN_CLASSES).map((id) => (
        <ClassRow key={id} id={id} name={store.nodeById.get(id)?.name ?? id} title={id} controller={controller} />
      ))}
      {ids.length > MAX_SHOWN_CLASSES && <div class="hint">And {ids.length - MAX_SHOWN_CLASSES} more.</div>}
    </>
  );
}

interface ClassRowProps {
  id: string;
  name: string;
  title: string;
  count?: number;
  controller: DiagramController;
}

/** One class: a press selects it and shows it in the diagram. */
function ClassRow({ id, name, title, count, controller }: ClassRowProps) {
  return (
    <PressableRow className="interface-class-name analysis-class" title={`${title}\nShow ${id} in the diagram`} onPress={() => controller.focusNode(id)}>
      <span class="row-label">{name}</span>
      {count !== undefined && <span class="count">{count}</span>}
    </PressableRow>
  );
}

interface LinkRowProps {
  link: UsageLink;
  nameOf: (id: string) => string;
  files: string[];
  controller: DiagramController;
}

/** One link "A uses B", with the first use that creates it; a press opens its line. */
function LinkRow({ link, nameOf, files, controller }: LinkRowProps) {
  const use = link.firstUse;
  const filePath = files[use.file] ?? '';
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
  const otherUses = link.useCount > 1 ? ` +${link.useCount - 1}` : '';
  return (
    <PressableRow
      className="interface-use"
      title={`${link.from} uses ${link.to}: ${interfaceUseLabel(use)}${otherUses === '' ? '' : `, and ${link.useCount - 1} other uses`}\nOpen ${filePath}:${use.line}`}
      onPress={() => controller.openSource(use.file, use.line)}
    >
      <span class="use-user">
        {nameOf(link.from)} → {nameOf(link.to)}
      </span>
      <span class="use-kind plain">
        {interfaceUseLabel(use)}
        {otherUses}
      </span>
      <span class="use-place">
        {fileName}:{use.line}
      </span>
    </PressableRow>
  );
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
