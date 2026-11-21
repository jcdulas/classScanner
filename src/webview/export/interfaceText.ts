// Writes the interface of a set of classes (spec §4.8) as plain text, to paste
// into a document or into a prompt for a language model.
//
// The text lists, class by class, what the rest of the code uses of the
// selection, then what the selection uses of the rest of the code. Each line
// is one use, with the file and line that says so.
//
// Example:
//   used by the rest of the code: 1 of 2 classes, used by 1 class
//     geo::Scene
//       dependency       geo::Renderer::render  [src/renderer.h:10]
//       call of add()    geo::Renderer::render  [src/renderer.cpp:12]

import { Graph } from '../../shared/graphModel';
import { InterfaceUse, SelectionInterface, UsedClass, countFreeFunctionUsers, countUsers } from '../model/selectionInterface';
import { interfaceUseLabel } from '../ui/labels';

/** The selected classes are named in the header up to this number; beyond it only their count is written. */
const MAX_NAMED_CLASSES = 30;

export function buildInterfaceText(graph: Graph, selection: Set<string>, selectionInterface: SelectionInterface, projectName: string): string {
  const { usedBy, uses, internalIds } = selectionInterface;
  const selectedIds = Array.from(selection).sort();
  const lines: string[] = [
    `# Interface of ${countOf(selectedIds.length, 'class', 'classes')} of ${projectName} with the rest of the code, exported by classScanner.`,
  ];
  if (selectedIds.length <= MAX_NAMED_CLASSES) {
    lines.push(`# Classes: ${selectedIds.join(', ')}`);
  }
  lines.push(
    '# Each line is one use: its kind, the class and the member that uses (or the free function, with `()`), and [file:line].',
    '# Calls are found without a compiler: some are missed, and a few may be wrong.',
    ...(hasConfirmedCall(selectionInterface) ? ['# A call marked "confirmed" was found by the C++ language extension of VS Code, which compiles the code.'] : []),
    '',
    `used by the rest of the code: ${usedBy.length} of ${countOf(selectedIds.length, 'class', 'classes')}, ` +
      `used by ${usersText(usedBy)}`,
    ...classLines(usedBy, graph.files),
    '',
    `uses of the rest of the code: ${countOf(uses.length, 'class', 'classes')}`,
    ...classLines(uses, graph.files),
  );
  if (internalIds.length > 0) {
    lines.push('', `not used from outside: ${internalIds.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

function classLines(classes: UsedClass[], files: string[]): string[] {
  const lines: string[] = [];
  for (const usedClass of classes) {
    lines.push(`  ${usedClass.id}`);
    // The kinds are aligned in a column, so that the classes that use can be read down the lines.
    const labelWidth = Math.max(...usedClass.uses.map((use) => interfaceUseLabel(use).length));
    for (const use of usedClass.uses) {
      const label = interfaceUseLabel(use).toLowerCase().padEnd(labelWidth);
      const confirmation = use.isConfirmed === true ? '  confirmed' : '';
      lines.push(`    ${label}  ${userText(use)}  [${files[use.file] ?? '?'}:${use.line}]${confirmation}`);
    }
  }
  return lines;
}

function hasConfirmedCall(selectionInterface: SelectionInterface): boolean {
  const classes = [...selectionInterface.usedBy, ...selectionInterface.uses];
  return classes.some((usedClass) => usedClass.uses.some((use) => use.isConfirmed === true));
}

/** The class that uses, with its member when it is known: `geo::Renderer::render`. */
function userText(use: InterfaceUse): string {
  return use.userMember === undefined ? use.userId : `${use.userId}::${use.userMember}`;
}

/** `5 classes`, followed by ` and 2 free functions` when there are some. */
export function usersText(classes: UsedClass[]): string {
  const functionCount = countFreeFunctionUsers(classes);
  const classesText = countOf(countUsers(classes), 'class', 'classes');
  return functionCount === 0 ? classesText : `${classesText} and ${countOf(functionCount, 'free function', 'free functions')}`;
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
