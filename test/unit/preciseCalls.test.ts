// Tests of the calls found by the C++ language extension (spec §3.3): how its answers become
// calls between classes (src/webview/model/preciseCalls.ts), how they complete the interface of
// a selection, and the reading of function names (src/extension/functionText.ts).
//
// The answers used here have the shape of real ones, noted from Microsoft C/C++ 1.35: for a
// caller, the lines that its function covers and its name without parameters.

import { describe, expect, it } from 'vitest';
import { columnOfFunctionName, plainFunctionName } from '../../src/extension/functionText';
import { Graph } from '../../src/shared/graphModel';
import { PreciseCall } from '../../src/shared/messages';
import { buildInterfaceText } from '../../src/webview/export/interfaceText';
import { PreciseCalls, addPreciseCalls, createEmptyPreciseCalls } from '../../src/webview/model/preciseCalls';
import { computeSelectionInterface } from '../../src/webview/model/selectionInterface';
import { SourceIndex } from '../../src/webview/model/sourceIndex';
import { buildGraphFromSources } from './testHelpers';

const SOURCES = {
  'tools.h': 'class Job { public: void run(); };\nclass Task { public: void run(); };\nclass Pool {\n public:\n  Job* nextJob();\n  Task* nextTask();\n  void work();\n};',
  'tools.cpp': [
    '#include "tools.h"',
    'void Job::run() {}',
    'void Task::run() {}',
    'void Pool::work() {',
    // Nothing tells the scan what a lambda returns, and Pool knows two classes that have a `run`.
    '  auto next = [this] { return nextJob(); };',
    '  next()->run();',
    // The type is written: the scan finds this call.
    '  Task task;',
    '  task.run();',
    '}',
  ].join('\n'),
  // In a file of its own: a function written in a file of a selected class is part of the selection.
  'main.cpp': '#include "tools.h"\nint main() {\n  Pool pool;\n  auto take = [&pool] { return pool.nextJob(); };\n  take()->run();\n  return 0;\n}',
};

async function buildWithAnswers(): Promise<{ graph: Graph; precise: PreciseCalls }> {
  const graph = await buildGraphFromSources(SOURCES);
  const source = graph.files.indexOf('tools.cpp');
  const work = { file: source, firstLine: 4, lastLine: 9, name: 'work' };
  const mainFile = graph.files.indexOf('main.cpp');
  const main = { file: mainFile, firstLine: 2, lastLine: 7, name: 'main' };
  const answers: PreciseCall[] = [
    { direction: 'incoming', classId: 'Job', method: 'run', other: work, file: source, line: 6 },
    { direction: 'incoming', classId: 'Job', method: 'run', other: main, file: mainFile, line: 5 },
    { direction: 'incoming', classId: 'Task', method: 'run', other: work, file: source, line: 8 },
    // What `work` calls, asked from the side of Pool: the same two calls, and a call inside the class.
    { direction: 'outgoing', classId: 'Pool', method: 'work', other: { file: source, firstLine: 2, lastLine: 2, name: 'run' }, file: source, line: 6 },
    { direction: 'outgoing', classId: 'Pool', method: 'work', other: { file: graph.files.indexOf('tools.h'), firstLine: 5, lastLine: 5, name: 'nextJob' }, file: source, line: 5 },
    // A function that is no method of the graph, such as one of a library.
    { direction: 'outgoing', classId: 'Pool', method: 'work', other: { file: source, firstLine: 40, lastLine: 41, name: 'printf' }, file: source, line: 7 },
  ];
  return { graph, precise: addPreciseCalls(createEmptyPreciseCalls(), ['Job', 'Task', 'Pool'], answers, new SourceIndex(graph)) };
}

describe('calls found by the language extension', () => {
  it('become calls between classes, and uses by free functions', async () => {
    const { precise } = await buildWithAnswers();
    expect(precise.calls.map((call) => `${call.from}::${call.fromMethod} -> ${call.to}::${call.method} @${call.line}`)).toEqual([
      'Pool::work -> Job::run @6',
      'Pool::work -> Task::run @8',
    ]);
    expect(precise.functionUses.map((use) => `${use.functionName} -> ${use.to}::${use.method} @${use.line}`)).toEqual(['main -> Job::run @5']);
    expect(Array.from(precise.classIds)).toEqual(['Job', 'Task', 'Pool']);
  });

  it('complete the interface of a selection, and confirm the calls that the scan found', async () => {
    const { graph, precise } = await buildWithAnswers();
    const describeUses = (classId: string, withPrecise: boolean) =>
      computeSelectionInterface(graph, new Set([classId]), withPrecise ? precise : undefined)
        .usedBy.flatMap((usedClass) => usedClass.uses)
        .filter((use) => use.kind === 'call')
        .map((use) => `${use.userId}${use.userMember === undefined ? '' : `::${use.userMember}`} calls ${use.calledMethod} @${use.line}${use.isConfirmed === true ? ' confirmed' : ''}`);

    // Without the language extension, the two calls on what a lambda returns are missed.
    expect(describeUses('Job', false)).toEqual([]);
    expect(describeUses('Job', true)).toEqual(['main() calls run @5 confirmed', 'Pool::work calls run @6 confirmed']);
    // The scan found this one: it is listed once, now confirmed.
    expect(describeUses('Task', false)).toEqual(['Pool::work calls run @8']);
    expect(describeUses('Task', true)).toEqual(['Pool::work calls run @8 confirmed']);
  });

  it('are marked in the text of the interface', async () => {
    const { graph, precise } = await buildWithAnswers();
    const selection = new Set(['Job']);
    const text = buildInterfaceText(graph, selection, computeSelectionInterface(graph, selection, precise), 'project');
    expect(text).toContain('# A call marked "confirmed" was found by the C++ language extension of VS Code, which compiles the code.');
    expect(text).toContain('    call of run()  Pool::work  [tools.cpp:6]  confirmed');
  });

  it('are added to the calls of the classes asked about before', async () => {
    const { graph, precise } = await buildWithAnswers();
    const again = addPreciseCalls(precise, ['Job'], [], new SourceIndex(graph));
    expect(again.calls).toHaveLength(2);
    expect(again.classIds.size).toBe(3);
  });
});

describe('text of functions', () => {
  it('finds the name of a function on a line of code, as a whole word', () => {
    expect(columnOfFunctionName('  Widget* get() const;', 'get')).toBe(10);
    expect(columnOfFunctionName('void Engine::run(Scene& scene) {', 'run')).toBe(13);
    expect(columnOfFunctionName('  bool operator==(const Point& other) const;', 'operator==')).toBe(7);
    // The return type alone on its line: the name is on the next one.
    expect(columnOfFunctionName('std::vector<Item>', 'items')).toBeUndefined();
    // A destructor is not the method named like it.
    expect(columnOfFunctionName('  ~Engine();', 'Engine')).toBeUndefined();
  });

  it('reads the plain name in the name that the language extension displays', () => {
    expect(plainFunctionName('area() const')).toBe('area');
    expect(plainFunctionName('total(Shape & shape)')).toBe('total');
    expect(plainFunctionName('Shape::area(int)')).toBe('area');
    expect(plainFunctionName('operator()(int value) const')).toBe('operator()');
    expect(plainFunctionName('main')).toBe('main');
  });
});
