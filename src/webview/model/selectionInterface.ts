// Computes how a set of classes is interfaced with the rest of the code (spec §4.8).
//
// The interface of a selection is everything that crosses its border, in two
// directions:
//   - "used by": what the rest of the code uses of the selection. These are
//     the relations and the method calls that go from a class outside the
//     selection to a class of the selection;
//   - "uses": what the selection needs from the rest of the code. These are
//     the relations and the calls that go from a class of the selection to a
//     class outside of it.
// Relations and calls between two classes of the selection are its inside:
// they are not part of its interface.
//
// In both directions the result is grouped by the class that is used: a class
// of the selection for "used by", an outside class for "uses". Each use names
// the class that uses it, and the line that says so. Every relation kind is
// taken, whether it is displayed in the diagram or not: a dependency does not
// disappear because its arrows are turned off.
//
// A relation is a use of its `to` class by its `from` class, except `friend`:
// the class that declares a friend opens itself to it, so it is the friend
// that uses the class that declares it.

import { ALL_RELATION_KINDS, Edge, Graph, RelationKind } from '../../shared/graphModel';

export type InterfaceUseKind = RelationKind | 'call';

/** One way in which a class uses another one, with the line of the sources that says so. */
export interface InterfaceUse {
  kind: InterfaceUseKind;
  /** The class that uses: the `from` class of the relation or of the call. */
  userId: string;
  /** The attribute or the method of the user that creates the use, when it is known. */
  userMember?: string;
  /** For a call: the name of the called method. */
  calledMethod?: string;
  /** Index in Graph.files, and 1-based line. */
  file: number;
  line: number;
}

/** A class with the uses of it that cross the border of the selection. */
export interface UsedClass {
  id: string;
  uses: InterfaceUse[];
}

export interface SelectionInterface {
  /** The classes of the selection that the rest of the code uses, with who uses them. */
  usedBy: UsedClass[];
  /** The classes outside the selection that the selection uses, with who uses them. */
  uses: UsedClass[];
  /** The classes of the selection that nothing outside uses. */
  internalIds: string[];
}

export function computeSelectionInterface(graph: Graph, selection: Set<string>): SelectionInterface {
  const usedBy = new Map<string, InterfaceUse[]>();
  const uses = new Map<string, InterfaceUse[]>();
  // A use crosses the border when exactly one of its two classes is in the selection.
  const record = (from: string, to: string, use: InterfaceUse) => {
    const isFromInside = selection.has(from);
    const isToInside = selection.has(to);
    if (isFromInside === isToInside) {
      return;
    }
    const group = isToInside ? usedBy : uses;
    const list = group.get(to) ?? [];
    list.push(use);
    group.set(to, list);
  };

  for (const edge of graph.edges) {
    const { userId, usedId } = useOfRelation(edge);
    for (const declaration of edge.declarations) {
      record(userId, usedId, { kind: edge.kind, userId, userMember: declaration.member, file: declaration.file, line: declaration.line });
    }
  }
  for (const call of graph.calls) {
    record(call.from, call.to, {
      kind: 'call',
      userId: call.from,
      userMember: call.fromMethod,
      calledMethod: call.method,
      file: call.file,
      line: call.line,
    });
  }

  return {
    usedBy: toSortedClasses(usedBy),
    uses: toSortedClasses(uses),
    internalIds: Array.from(selection).filter((id) => !usedBy.has(id)).sort(),
  };
}

/** Which class uses which in a relation: its `from` class uses its `to` class, except for `friend`. */
export function useOfRelation(edge: Edge): { userId: string; usedId: string } {
  return edge.kind === 'friend' ? { userId: edge.to, usedId: edge.from } : { userId: edge.from, usedId: edge.to };
}

/**
 * The list of the interface that a relation belongs to: `usedBy` when a class outside the
 * selection uses a class of the selection, `uses` for the opposite, and undefined when the
 * relation does not cross the border of the selection.
 */
export function interfaceDirectionOf(edge: Edge, selection: Set<string>): 'usedBy' | 'uses' | undefined {
  const { userId, usedId } = useOfRelation(edge);
  const isUserInside = selection.has(userId);
  const isUsedInside = selection.has(usedId);
  if (isUserInside === isUsedInside) {
    return undefined;
  }
  return isUsedInside ? 'usedBy' : 'uses';
}

/** Number of distinct classes that use the classes of a list. */
export function countUsers(classes: UsedClass[]): number {
  const userIds = new Set<string>();
  for (const usedClass of classes) {
    for (const use of usedClass.uses) {
      userIds.add(use.userId);
    }
  }
  return userIds.size;
}

function toSortedClasses(usesByClass: Map<string, InterfaceUse[]>): UsedClass[] {
  return Array.from(usesByClass, ([id, classUses]) => ({ id, uses: classUses.sort(compareUses) })).sort((first, second) =>
    first.id.localeCompare(second.id),
  );
}

/** Relations first, in the order of the relation kinds, then calls by method name; then by user and place. */
function compareUses(first: InterfaceUse, second: InterfaceUse): number {
  return (
    kindRank(first.kind) - kindRank(second.kind) ||
    (first.calledMethod ?? '').localeCompare(second.calledMethod ?? '') ||
    first.userId.localeCompare(second.userId) ||
    first.file - second.file ||
    first.line - second.line
  );
}

function kindRank(kind: InterfaceUseKind): number {
  return kind === 'call' ? ALL_RELATION_KINDS.length : ALL_RELATION_KINDS.indexOf(kind);
}
