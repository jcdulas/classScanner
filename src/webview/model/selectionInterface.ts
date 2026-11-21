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
//
// Functions that belong to no class, such as `main`, use classes too (spec
// §3.2). A selection is made of classes, so a free function is placed by its
// file: it is inside the selection when it is written in a file of a selected
// class, the file that declares the class or one that defines its methods. A
// helper function next to the methods of a class is part of that class's code.
//
// The calls found by the C++ language extension, when the user asked for them
// (spec §3.3), complete the calls of the scan: a call that both found is
// marked as confirmed, and a call that only the language extension found is
// added, confirmed too.

import { ALL_RELATION_KINDS, Edge, FunctionUse, Graph, MethodCall, RelationKind } from '../../shared/graphModel';
import { PreciseCalls, createEmptyPreciseCalls, methodCallKey } from './preciseCalls';

export type InterfaceUseKind = RelationKind | 'call';

/** One way in which a class uses another one, with the line of the sources that says so. */
export interface InterfaceUse {
  kind: InterfaceUseKind;
  /**
   * The class that uses: the `from` class of the relation or of the call. For a use by a free
   * function, its qualified name followed by `()`, for example `app::main()`.
   */
  userId: string;
  /** True when the user is a function that belongs to no class. */
  isFreeFunction?: boolean;
  /** For a call: true when the C++ language extension found it (spec §3.3). */
  isConfirmed?: boolean;
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

/** `precise` holds the calls that the C++ language extension found, if it was asked. */
export function computeSelectionInterface(
  graph: Graph,
  selection: Set<string>,
  precise: PreciseCalls = createEmptyPreciseCalls(),
): SelectionInterface {
  const usedBy = new Map<string, InterfaceUse[]>();
  const uses = new Map<string, InterfaceUse[]>();
  // A use crosses the border when exactly one of its two ends is in the selection.
  const record = (isFromInside: boolean, to: string, use: InterfaceUse) => {
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
      const use: InterfaceUse = { kind: edge.kind, userId, userMember: declaration.member, file: declaration.file, line: declaration.line };
      record(selection.has(userId), usedId, use);
    }
  }
  for (const { call, isConfirmed } of mergeCalls(graph.calls, precise.calls)) {
    record(selection.has(call.from), call.to, {
      kind: 'call',
      userId: call.from,
      userMember: call.fromMethod,
      calledMethod: call.method,
      isConfirmed,
      file: call.file,
      line: call.line,
    });
  }

  const selectionFiles = filesOfClasses(graph, selection);
  for (const { functionUse, isConfirmed } of mergeFunctionUses(graph.functionUses, precise.functionUses)) {
    record(selectionFiles.has(functionUse.file), functionUse.to, {
      kind: functionUse.kind,
      userId: `${functionUse.functionName}()`,
      isFreeFunction: true,
      calledMethod: functionUse.method,
      isConfirmed,
      file: functionUse.file,
      line: functionUse.line,
    });
  }

  return {
    usedBy: toSortedClasses(usedBy),
    uses: toSortedClasses(uses),
    internalIds: Array.from(selection).filter((id) => !usedBy.has(id)).sort(),
  };
}

/** The calls of the scan, each marked when the language extension found it too, then the calls that only it found. */
function mergeCalls(scanCalls: MethodCall[], preciseCalls: MethodCall[]): { call: MethodCall; isConfirmed: boolean }[] {
  const preciseKeys = new Set(preciseCalls.map(methodCallKey));
  const scanKeys = new Set(scanCalls.map(methodCallKey));
  return [
    ...scanCalls.map((call) => ({ call, isConfirmed: preciseKeys.has(methodCallKey(call)) })),
    ...preciseCalls.filter((call) => !scanKeys.has(methodCallKey(call))).map((call) => ({ call, isConfirmed: true })),
  ];
}

/**
 * The same for the uses by free functions. The scan names a function with its namespaces
 * (`app::run`) and the language extension without them (`run`): a call is the same when the
 * file, the class and the method are, and one name ends with the other.
 */
function mergeFunctionUses(scanUses: FunctionUse[], preciseUses: FunctionUse[]): { functionUse: FunctionUse; isConfirmed: boolean }[] {
  const isSameCall = (scanUse: FunctionUse, preciseUse: FunctionUse) =>
    scanUse.kind === 'call' &&
    scanUse.file === preciseUse.file &&
    scanUse.to === preciseUse.to &&
    scanUse.method === preciseUse.method &&
    (scanUse.functionName === preciseUse.functionName || scanUse.functionName.endsWith(`::${preciseUse.functionName}`));
  return [
    ...scanUses.map((functionUse) => ({ functionUse, isConfirmed: preciseUses.some((preciseUse) => isSameCall(functionUse, preciseUse)) })),
    ...preciseUses
      .filter((preciseUse) => !scanUses.some((scanUse) => isSameCall(scanUse, preciseUse)))
      .map((functionUse) => ({ functionUse, isConfirmed: true })),
  ];
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
  return countDistinctUsers(classes, false);
}

/** Number of distinct free functions that use the classes of a list. */
export function countFreeFunctionUsers(classes: UsedClass[]): number {
  return countDistinctUsers(classes, true);
}

function countDistinctUsers(classes: UsedClass[], areFreeFunctions: boolean): number {
  const userIds = new Set<string>();
  for (const usedClass of classes) {
    for (const use of usedClass.uses) {
      if ((use.isFreeFunction === true) === areFreeFunctions) {
        userIds.add(use.userId);
      }
    }
  }
  return userIds.size;
}

/** The files of a set of classes: those that declare them and those that define their methods (indexes in Graph.files). */
function filesOfClasses(graph: Graph, classIds: Set<string>): Set<number> {
  const files = new Set<number>();
  for (const node of graph.nodes) {
    if (classIds.has(node.id)) {
      files.add(node.file);
      for (const file of node.definitionFiles ?? []) {
        files.add(file);
      }
    }
  }
  return files;
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
