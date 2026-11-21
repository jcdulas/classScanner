// Turns the calls found by the C++ language extension (spec §3.3) into calls
// between the classes of the graph.
//
// The extension host asks the language extension about the methods of some
// classes and sends what it answered: for each call, the method that was asked
// about, and the other function as a place in a file (messages.ts). This
// module finds which method of which class that place is, with the lines kept
// by the scan (sourceIndex.ts):
//   - a caller that is a method of a class gives a call between two classes;
//   - a caller that is no method of the graph is a free function (spec §3.2);
//   - a called function that is no method of the graph (a free function, a
//     method of a library) is left out: only uses of classes are listed.

import { FunctionUse, MethodCall } from '../../shared/graphModel';
import { PreciseCall } from '../../shared/messages';
import { SourceIndex } from './sourceIndex';

/** Calls confirmed by the language extension, in the form of the calls of the scan. */
export interface PreciseCalls {
  /** The classes whose methods were asked about: their calls are complete, as far as the language extension knows. */
  classIds: Set<string>;
  calls: MethodCall[];
  functionUses: FunctionUse[];
}

export function createEmptyPreciseCalls(): PreciseCalls {
  return { classIds: new Set(), calls: [], functionUses: [] };
}

/** Adds the answers about some classes to the calls already confirmed. Returns a new object. */
export function addPreciseCalls(known: PreciseCalls, classIds: string[], answers: PreciseCall[], index: SourceIndex): PreciseCalls {
  const callsByKey = new Map(known.calls.map((call) => [methodCallKey(call), call]));
  const functionUsesByKey = new Map(known.functionUses.map((use) => [functionUseKey(use), use]));
  for (const answer of answers) {
    const other = index.methodIn(answer.other.file, answer.other.firstLine, answer.other.lastLine, answer.other.name);
    if (answer.direction === 'incoming' && other === undefined) {
      const use: FunctionUse = { functionName: answer.other.name, to: answer.classId, kind: 'call', method: answer.method, file: answer.file, line: answer.line };
      setIfAbsent(functionUsesByKey, functionUseKey(use), use);
      continue;
    }
    if (other === undefined || other.classId === answer.classId) {
      continue; // Not a method of the graph, or a call inside the class.
    }
    const asked = { classId: answer.classId, method: answer.method };
    const [caller, callee] = answer.direction === 'incoming' ? [other, asked] : [asked, other];
    const call: MethodCall = { from: caller.classId, fromMethod: caller.method, to: callee.classId, method: callee.method, file: answer.file, line: answer.line };
    setIfAbsent(callsByKey, methodCallKey(call), call);
  }
  return {
    classIds: new Set([...known.classIds, ...classIds]),
    calls: Array.from(callsByKey.values()),
    functionUses: Array.from(functionUsesByKey.values()),
  };
}

/** A call is kept once per calling method, called class and method name, like the calls of the scan (spec §3.1). */
export function methodCallKey(call: MethodCall): string {
  return `${call.from}|${call.fromMethod}|${call.to}|${call.method}`;
}

export function functionUseKey(use: FunctionUse): string {
  return `${use.functionName}|${use.file}|${use.to}|${use.kind}|${use.method ?? ''}`;
}

function setIfAbsent<Value>(map: Map<string, Value>, key: string, value: Value): void {
  if (!map.has(key)) {
    map.set(key, value);
  }
}
