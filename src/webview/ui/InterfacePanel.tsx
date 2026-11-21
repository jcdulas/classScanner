// The panel that lists how the selected classes are interfaced with the rest of
// the code (spec §4.8). It opens from the "Interface" button of the selection
// bar and has two lists:
//   - "Used by": the classes of the selection that the rest of the code uses;
//   - "Uses": the classes outside the selection that the selection uses.
// Each class is followed by the uses of it, one line per relation declaration
// or method call. A click on a line opens it in the editor.

import { useMemo, useState } from 'preact/hooks';
import { ClassNode } from '../../shared/graphModel';
import { DiagramController } from '../controller';
import { InterfaceUse, UsedClass, computeSelectionInterface, countUsers } from '../model/selectionInterface';
import { GlassButton, PressableRow, Segmented, SegmentOption } from './controls';
import { Icon } from './Icon';
import { interfaceUseLabel } from './labels';
import { useStore } from './useStore';

type Direction = 'usedBy' | 'uses';

/** A class with more uses than this shows the first ones only: the copied text has them all. */
const MAX_SHOWN_USES = 100;
/** With more classes than this in a list, the classes start folded, to keep the list short. */
const MAX_UNFOLDED_CLASSES = 8;

interface InterfacePanelProps {
  controller: DiagramController;
}

export function InterfacePanel({ controller }: InterfacePanelProps) {
  const store = useStore(controller.store);
  const [direction, setDirection] = useState<Direction>('usedBy');
  const { graph, selection } = store;
  const isShown = store.showsSelectionInterface;
  // Computed again only when the graph or the selection changes: the store gives a new set for each selection.
  const selectionInterface = useMemo(
    () => (isShown && graph !== undefined ? computeSelectionInterface(graph, selection) : undefined),
    [isShown, graph, selection],
  );
  if (graph === undefined || selectionInterface === undefined) {
    return null;
  }

  const { usedBy, uses, internalIds } = selectionInterface;
  const classes = direction === 'usedBy' ? usedBy : uses;
  const options: SegmentOption[] = [
    { value: 'usedBy', label: `Used by ${usedBy.length}`, title: 'The classes of the selection that the rest of the code uses' },
    { value: 'uses', label: `Uses ${uses.length}`, title: 'The classes outside the selection that the selection uses' },
  ];
  const summary =
    direction === 'usedBy'
      ? `${usedBy.length} of ${countOf(selection.size, 'class is', 'classes are')} used by ${countOf(countUsers(usedBy), 'class', 'classes')} outside the selection.`
      : `The selection uses ${countOf(uses.length, 'class', 'classes')} outside of it.`;

  return (
    <div class="interface-panel glass">
      <div class="interface-header">
        <span class="section-title">Interface of {countOf(selection.size, 'class', 'classes')}</span>
        <span class="spacer" />
        <GlassButton icon="copy" title="Copy the interface as text, to paste into a document or a prompt" onPress={() => controller.copySelectionInterface()} />
        <GlassButton icon="close" title="Close the interface" onPress={() => store.toggleInterfacePanel()} />
      </div>
      <Segmented options={options} value={direction} onChange={(value) => setDirection(value as Direction)} />
      <div class="hint">{summary}</div>
      <div class={`interface-list ${direction}`}>
        {classes.map((usedClass) => (
          <UsedClassSection
            // The direction is part of the key: a class listed in both directions gets two fold states.
            key={`${direction}|${usedClass.id}`}
            usedClass={usedClass}
            node={store.nodeById.get(usedClass.id)}
            files={graph.files}
            nameOf={(id) => store.nodeById.get(id)?.name ?? id}
            isInitiallyOpen={classes.length <= MAX_UNFOLDED_CLASSES}
            controller={controller}
          />
        ))}
        {direction === 'usedBy' && internalIds.length > 0 && (
          <div class="hint" title={internalIds.join('\n')}>
            Not used from outside: {internalIds.map((id) => store.nodeById.get(id)?.name ?? id).join(', ')}
          </div>
        )}
      </div>
      <div class="hint interface-note">
        Every relation kind is listed, displayed or not. Calls are found without a compiler: some are missed, and a few may be wrong.
      </div>
    </div>
  );
}

interface UsedClassSectionProps {
  usedClass: UsedClass;
  node: ClassNode | undefined;
  files: string[];
  nameOf: (id: string) => string;
  isInitiallyOpen: boolean;
  controller: DiagramController;
}

/** One class that is used, with the lines of its uses under it. */
function UsedClassSection({ usedClass, node, files, nameOf, isInitiallyOpen, controller }: UsedClassSectionProps) {
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  const shownUses = usedClass.uses.slice(0, MAX_SHOWN_USES);
  return (
    <div class="interface-class">
      <div class="interface-class-header">
        <PressableRow className="interface-class-name" title={usedClass.id} isExpanded={isOpen} onPress={() => setIsOpen(!isOpen)}>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} />
          <span class="row-label">{node?.name ?? usedClass.id}</span>
          <span class="count">{usedClass.uses.length}</span>
        </PressableRow>
        <GlassButton icon="locate" title={`Show ${usedClass.id} in the diagram`} onPress={() => controller.revealNode(usedClass.id)} />
      </div>
      {isOpen &&
        shownUses.map((use) => (
          <UseRow key={`${use.kind}|${use.userId}|${use.file}|${use.line}|${use.calledMethod ?? ''}`} use={use} files={files} nameOf={nameOf} controller={controller} />
        ))}
      {isOpen && usedClass.uses.length > MAX_SHOWN_USES && (
        <div class="hint">And {usedClass.uses.length - MAX_SHOWN_USES} more: copy the interface to get them all.</div>
      )}
    </div>
  );
}

interface UseRowProps {
  use: InterfaceUse;
  files: string[];
  nameOf: (id: string) => string;
  controller: DiagramController;
}

/** One use: its kind, the class and the member that uses, and the place, which a click opens. */
function UseRow({ use, files, nameOf, controller }: UseRowProps) {
  const filePath = files[use.file] ?? '';
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
  const user = use.userMember === undefined ? nameOf(use.userId) : `${nameOf(use.userId)}::${use.userMember}`;
  return (
    <PressableRow
      className="interface-use"
      title={`${interfaceUseLabel(use)}, from ${use.userId}\nOpen ${filePath}:${use.line}`}
      onPress={() => controller.openSource(use.file, use.line)}
    >
      <span class={`use-kind ${use.kind === 'call' ? 'call' : ''}`}>{interfaceUseLabel(use)}</span>
      <span class="use-user">{user}</span>
      <span class="use-place">
        {fileName}:{use.line}
      </span>
    </PressableRow>
  );
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
