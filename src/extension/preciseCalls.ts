// Asks the C++ language extension installed in VS Code who calls the methods of
// some classes, and what these methods call (spec §3.3).
//
// The scan finds calls without a compiler: it works out the type of simple
// expressions only (§3.1), and misses the calls whose object is what a lambda
// or a template returns, or depends on the choice of an overload. A language
// extension such as Microsoft C/C++ compiles the code and knows. VS Code gives
// every extension access to what it finds through three commands, whichever
// language extension answers them:
//   - `vscode.prepareCallHierarchy`: the function at a place of a file;
//   - `vscode.provideIncomingCalls`: the functions that call it;
//   - `vscode.provideOutgoingCalls`: the functions that it calls.
//
// This is slow: measured with Microsoft C/C++ 1.35 on the synthetic project
// (2000 files), "who calls" takes about 3 s per method, and "what it calls"
// about 10 ms. It is therefore done on request, for the selected classes only,
// one method after the other, and it can be cancelled.
//
// Two limits come from the language extension, as measured:
//   - a method without code in the project (pure virtual, or defined in a
//     library) is not known to the call hierarchy: no answer for it;
//   - a call through a pointer to a base class is a call of the method of the
//     base class, not of the methods that override it.

import path from 'node:path';
import * as vscode from 'vscode';
import { ClassNode, Graph, Member, MemberFlags } from '../shared/graphModel';
import { LocatedFunction, PreciseCall } from '../shared/messages';
import { columnOfFunctionName, plainFunctionName } from './functionText';

export interface PreciseCallsResult {
  calls: PreciseCall[];
  /** Number of methods the language extension was asked about. */
  askedMethodCount: number;
  /** Number of them it did not know: methods without code in the project, in general. */
  unansweredMethodCount: number;
  /** The classes whose methods were all asked about: every class, unless the user cancelled. */
  completedClassIds: string[];
  wasCancelled: boolean;
}

/**
 * A language extension needs a few seconds after it starts before it answers. Until one method
 * has been answered, a method without an answer is asked again during this time.
 */
const STARTUP_WAIT_MS = 15_000;
const RETRY_DELAY_MS = 1_500;

/** True once a language extension has answered in this session of VS Code. */
let hasAnswered = false;

/** The methods to ask about: those of the classes that can have code. */
export function methodsToAsk(graph: Graph, classIds: string[]): { node: ClassNode; method: Member }[] {
  const wanted = new Set(classIds);
  const methods: { node: ClassNode; method: Member }[] = [];
  for (const node of graph.nodes) {
    if (!wanted.has(node.id) || node.isExternal) {
      continue;
    }
    for (const method of node.methods) {
      // Constructors and destructors are not listed as calls (spec §3.1), and a pure virtual
      // method has no code to ask about.
      const isConstructorOrDestructor = method.name === node.name || method.name.startsWith('~');
      if (!isConstructorOrDestructor && (method.flags & MemberFlags.PureVirtual) === 0) {
        methods.push({ node, method });
      }
    }
  }
  return methods;
}

export async function collectPreciseCalls(
  graph: Graph,
  classIds: string[],
  onProgress: (doneCount: number, totalCount: number, methodName: string) => void,
  token: vscode.CancellationToken,
): Promise<PreciseCallsResult> {
  const fileIndexByPath = new Map<string, number>();
  graph.files.forEach((relativePath, index) => fileIndexByPath.set(comparablePath(path.join(graph.root, relativePath)), index));
  const fileIndexOf = (uri: vscode.Uri) => fileIndexByPath.get(comparablePath(uri.fsPath));

  const methods = methodsToAsk(graph, classIds);
  const result: PreciseCallsResult = { calls: [], askedMethodCount: methods.length, unansweredMethodCount: 0, completedClassIds: classIds, wasCancelled: false };
  const startTime = Date.now();
  for (const [index, { node, method }] of methods.entries()) {
    if (token.isCancellationRequested) {
      const unfinishedClassIds = new Set(methods.slice(index).map((remaining) => remaining.node.id));
      result.completedClassIds = classIds.filter((id) => !unfinishedClassIds.has(id));
      result.wasCancelled = true;
      break;
    }
    onProgress(index, methods.length, `${node.name}::${method.name}`);
    let item = await findFunction(graph, method);
    while (item === undefined && !hasAnswered && Date.now() - startTime < STARTUP_WAIT_MS && !token.isCancellationRequested) {
      await delay(RETRY_DELAY_MS);
      item = await findFunction(graph, method);
    }
    if (item === undefined) {
      result.unansweredMethodCount++;
      continue;
    }
    hasAnswered = true;

    const incoming = (await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[] | undefined>('vscode.provideIncomingCalls', item)) ?? [];
    for (const call of incoming) {
      const callerFile = fileIndexOf(call.from.uri);
      // A caller outside the scanned files cannot be placed in the diagram.
      if (callerFile !== undefined && call.fromRanges.length > 0) {
        const line = call.fromRanges[0].start.line + 1;
        result.calls.push({ direction: 'incoming', classId: node.id, method: method.name, other: locate(call.from, callerFile), file: callerFile, line });
      }
    }

    const ownFile = fileIndexOf(item.uri);
    const outgoing = (await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[] | undefined>('vscode.provideOutgoingCalls', item)) ?? [];
    for (const call of outgoing) {
      const calleeFile = fileIndexOf(call.to.uri);
      if (calleeFile !== undefined && ownFile !== undefined && call.fromRanges.length > 0) {
        const line = call.fromRanges[0].start.line + 1;
        result.calls.push({ direction: 'outgoing', classId: node.id, method: method.name, other: locate(call.to, calleeFile), file: ownFile, line });
      }
    }
  }
  return result;
}

/**
 * The function that the language extension sees where the scan found the method: at its
 * definition when it is outside the class, otherwise at its declaration.
 */
async function findFunction(graph: Graph, method: Member): Promise<vscode.CallHierarchyItem | undefined> {
  const place = method.definition ?? { file: method.file, line: method.line };
  const uri = vscode.Uri.file(path.join(graph.root, graph.files[place.file]));
  const position = await positionOfName(uri, place.line, method.name);
  if (position === undefined) {
    return undefined;
  }
  const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[] | undefined>('vscode.prepareCallHierarchy', uri, position);
  return items?.[0];
}

/**
 * The scan keeps the line where a method starts, and the commands need the place of its name.
 * The name is searched on that line and on the two next ones: a return type can be written on
 * a line of its own.
 */
async function positionOfName(uri: vscode.Uri, line: number, name: string): Promise<vscode.Position | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  for (let lineIndex = line - 1; lineIndex < Math.min(line + 2, document.lineCount); lineIndex++) {
    const column = columnOfFunctionName(document.lineAt(lineIndex).text, name);
    if (column !== undefined) {
      return new vscode.Position(lineIndex, column);
    }
  }
  return undefined;
}

function locate(item: vscode.CallHierarchyItem, file: number): LocatedFunction {
  return { file, firstLine: item.range.start.line + 1, lastLine: item.range.end.line + 1, name: plainFunctionName(item.name) };
}

/** A path in a form that compares equal for the same file: Windows paths ignore case. */
function comparablePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
