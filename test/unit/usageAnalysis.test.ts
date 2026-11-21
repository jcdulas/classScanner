// Tests of the analysis panel (spec §4.9): the cycles, the paths and the ranking of the "uses"
// graph, the class that a line of a file belongs to, the reading of a git diff, and the uses
// of classes by free functions (spec §3.2).

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { listChangedLines, parseDiff } from '../../src/extension/gitChanges';
import { Graph } from '../../src/shared/graphModel';
import { groupKeyOf } from '../../src/webview/model/groups';
import { SourceIndex } from '../../src/webview/model/sourceIndex';
import { UsageAnalysis, analyzeUsage, classesAlong, findUsagePath } from '../../src/webview/model/usageAnalysis';
import { findUsageCycles } from '../../src/webview/model/usageCycles';
import { UsageLink } from '../../src/webview/model/usageLinks';
import { FIXTURES_DIRECTORY, buildGraphFromSources, scanTestFolder } from './testHelpers';

// Model and View use each other; Loader reaches File through Reader; Logger, in `io`, uses a
// class of `ui`, and `ui` uses `io`: the two namespaces form a cycle. Nothing uses Orphan.
const SOURCES = {
  'model.h': 'namespace ui {\nclass View;\nclass Model {\n  View* view;\n};\n}',
  'view.h': 'namespace ui {\nclass View {\n public:\n  void show(Model& model);\n};\n}',
  'io.h': 'namespace io {\nclass File {};\nclass Reader {\n  File file;\n};\nclass Logger {\n public:\n  void log(ui::Model* model);\n};\n}',
  'loader.h': 'namespace ui {\nclass Loader {\n  io::Reader reader;\n};\n}\nclass Orphan {};',
};

async function analyzeSources(sources: Record<string, string>): Promise<{ graph: Graph; analysis: UsageAnalysis }> {
  const graph = await buildGraphFromSources(sources);
  const groupKeyByClass = new Map(graph.nodes.map((node) => [node.id, groupKeyOf(node, 'namespace', graph.files)]));
  return { graph, analysis: analyzeUsage(graph, groupKeyByClass) };
}

function describeLinks(links: UsageLink[]): string[] {
  return links.map((link) => `${link.from} -> ${link.to}`);
}

describe('cycles of uses', () => {
  it('finds the classes that use each other, with a circle of uses as an example', async () => {
    const { graph, analysis } = await analyzeSources(SOURCES);
    expect(analysis.classCycles.map((cycle) => cycle.ids)).toEqual([['ui::Model', 'ui::View']]);
    const example = analysis.classCycles[0].example;
    expect(describeLinks(example)).toEqual(['ui::Model -> ui::View', 'ui::View -> ui::Model']);
    // Each link gives the line that creates it.
    expect(example.map((link) => `${link.firstUse.kind} @${graph.files[link.firstUse.file]}:${link.firstUse.line}`)).toEqual([
      'aggregate @model.h:4',
      'depend @view.h:4',
    ]);
  });

  it('finds the cycles between groups', async () => {
    const { analysis } = await analyzeSources(SOURCES);
    expect(analysis.groupCycles.map((cycle) => cycle.ids)).toEqual([['io', 'ui']]);
    expect(describeLinks(analysis.groupCycles[0].example)).toEqual(['io -> ui', 'ui -> io']);
  });

  it('reports a long cycle once, and nothing for a chain', async () => {
    const chain = await analyzeSources({ 'chain.h': 'class C {};\nclass B { C c; };\nclass A { B b; };' });
    expect(chain.analysis.classCycles).toEqual([]);

    const ring = await analyzeSources({
      'ring.h': 'class B;\nclass C;\nclass A { B* b; };\nclass B { C* c; };\nclass C { A* a; };\nclass User { A a; };',
    });
    expect(ring.analysis.classCycles.map((cycle) => cycle.ids)).toEqual([['A', 'B', 'C']]);
    expect(ring.analysis.classCycles[0].example).toHaveLength(3);
  });

  it('walks a chain of thousands of classes without overflowing the call stack', () => {
    const links: UsageLink[] = [];
    const use = { kind: 'depend' as const, userId: '', file: 0, line: 1 };
    for (let index = 0; index < 20000; index++) {
      links.push({ from: `C${index}`, to: `C${index + 1}`, firstUse: use, useCount: 1 });
    }
    links.push({ from: 'C20000', to: 'C19999', firstUse: use, useCount: 1 });
    expect(findUsageCycles(links).map((cycle) => cycle.ids)).toEqual([['C19999', 'C20000']]);
  });
});

describe('path of uses between two classes', () => {
  it('gives the shortest chain, in one direction only when the other does not exist', async () => {
    const { analysis } = await analyzeSources(SOURCES);
    const path = findUsagePath(analysis, 'ui::Loader', 'io::File')!;
    expect(describeLinks(path)).toEqual(['ui::Loader -> io::Reader', 'io::Reader -> io::File']);
    expect(classesAlong(path)).toEqual(['ui::Loader', 'io::Reader', 'io::File']);
    expect(findUsagePath(analysis, 'io::File', 'ui::Loader')).toBeUndefined();
    expect(findUsagePath(analysis, 'io::File', 'io::File')).toBeUndefined();
  });
});

describe('ranking of the classes by their users', () => {
  it('lists the most used classes first, and the classes that nothing uses', async () => {
    const { analysis } = await analyzeSources(SOURCES);
    expect(analysis.ranking.mostUsed.map((usage) => `${usage.id} ${usage.userCount}`)).toEqual([
      'ui::Model 2',
      'io::File 1',
      'io::Reader 1',
      'ui::View 1',
    ]);
    expect(analysis.ranking.unusedIds).toEqual(['io::Logger', 'Orphan', 'ui::Loader']);
  });

  it('counts a class used by a free function as used', async () => {
    const { analysis } = await analyzeSources({ ...SOURCES, 'main.cpp': 'int main() {\n  Orphan orphan;\n  return 0;\n}' });
    expect(analysis.ranking.unusedIds).toEqual(['io::Logger', 'ui::Loader']);
  });
});

describe('uses by free functions', () => {
  it('takes a function qualified by a namespace as a free function', async () => {
    const graph = await buildGraphFromSources({
      'registry.h': 'class Registry {\n public:\n  static void clear();\n};',
      'app.cpp': 'namespace app { void shutdown(); }\nvoid app::shutdown() {\n  Registry::clear();\n}',
    });
    expect(graph.functionUses.map((use) => `${use.kind} ${use.functionName} -> ${use.to}${use.method === undefined ? '' : `::${use.method}`} @${use.line}`)).toEqual([
      'depend app::shutdown -> Registry @3',
      'call app::shutdown -> Registry::clear @3',
    ]);
  });
});

describe('class that a line belongs to', () => {
  it('finds the enclosing class or out-of-class definition', async () => {
    const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
    const index = new SourceIndex(graph);
    const header = graph.files.indexOf('include/geometry/scene.h');
    const source = graph.files.indexOf('src/scene.cpp');
    expect(index.classAt(header, 13)).toBe('geo::Scene');
    // The nested struct starts at line 16; the attributes of Scene follow it from line 20.
    expect(index.classAt(header, 17)).toBe('geo::Scene::Statistics');
    expect(index.classesInRange(header, { firstLine: 16, lastLine: 18 })).toEqual(['geo::Scene::Statistics']);
    expect(index.classAt(header, 19)).toBe('geo::Scene');
    expect(index.classAt(header, 21)).toBe('geo::Scene');
    expect(index.classAt(header, 29)).toBe('geo::Layer');
    // In the code of a method defined in the .cpp file.
    expect(index.classAt(source, 9)).toBe('geo::Scene');
  });

  it('shows the first class of the file for a line above every class', async () => {
    const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
    const index = new SourceIndex(graph);
    const header = graph.files.indexOf('include/geometry/scene.h');
    expect(index.classAt(header, 3)).toBeUndefined();
    expect(index.classToShowAt(header, 3)).toBe('geo::Scene');
  });

  it('lists the classes that have lines in a range', async () => {
    const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
    const index = new SourceIndex(graph);
    const header = graph.files.indexOf('include/geometry/scene.h');
    expect(index.classesInRange(header, { firstLine: 28, lastLine: 29 })).toEqual(['geo::Layer']);
    expect(index.classesInRange(header, { firstLine: 22, lastLine: 28 }).sort()).toEqual(['geo::Layer', 'geo::Scene']);
    // A new file is changed as a whole.
    expect(index.classesInRange(header, { firstLine: 1, lastLine: Number.MAX_SAFE_INTEGER }).sort()).toEqual([
      'geo::Layer',
      'geo::Scene',
      'geo::Scene::Statistics',
    ]);
  });

  it('leaves free functions and gaps unowned and keeps every conditional definition', async () => {
    const graph = await buildGraphFromSources({ 'a.cpp': [
      'struct A { void run(); };',
      'int helper() { return 42; }',
      '#if FAST',
      'void A::run() {',
      '}',
      '#else',
      'void A::run() {}',
      '#endif',
      'template<class T>',
      'struct Box {};',
    ].join('\n') });
    const index = new SourceIndex(graph);
    expect(index.classToShowAt(0, 2)).toBeUndefined();
    expect(index.classesInRange(0, { firstLine: 2, lastLine: 3 })).toEqual([]);
    expect(index.classesInRange(0, { firstLine: 1, lastLine: 2, deletionOnly: true })).toEqual([]);
    expect(index.classesInRange(0, { firstLine: 4, lastLine: 5, deletionOnly: true })).toEqual(['A']);
    expect(index.classAt(0, 7)).toBe('A');
    expect(index.classAt(0, 9)).toBe('Box');
  });
});

/** True when git can be run: the test of a real repository is skipped without it. */
function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('changes of a real git repository', () => {
  it.skipIf(!isGitAvailable())('lists the lines changed since the last commit and since a branch, and new files', async () => {
    const repository = mkdtempSync(path.join(os.tmpdir(), 'classscanner-git-'));
    const git = (...gitArguments: string[]) =>
      execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...gitArguments], {
        cwd: repository,
        stdio: 'ignore',
      });
    try {
      git('init', '--initial-branch=main');
      writeFileSync(path.join(repository, 'engine.h'), 'class Engine {\n  void run();\n  void stop();\n};\n');
      git('add', '.');
      git('commit', '-m', 'first');
      git('checkout', '-b', 'work');
      // Committed on the work branch: line 2 changes. Not committed: a new file.
      writeFileSync(path.join(repository, 'engine.h'), 'class Engine {\n  void run(int steps);\n  void stop();\n};\n');
      git('commit', '-am', 'second');
      writeFileSync(path.join(repository, 'timer.h'), 'class Timer {};\n');

      const describe = (files: { path: string; ranges: { firstLine: number; lastLine: number }[] }[]) =>
        files.map((file) => `${path.basename(file.path)} ${file.ranges.map((range) => `${range.firstLine}-${range.lastLine}`).join(' ')}`).sort();
      expect(describe(await listChangedLines(repository, 'main'))).toEqual(['engine.h 2-2', `timer.h 1-${Number.MAX_SAFE_INTEGER}`]);
      // Since the last commit, only the new file is a change.
      expect(describe(await listChangedLines(repository, 'HEAD'))).toEqual([`timer.h 1-${Number.MAX_SAFE_INTEGER}`]);
      await expect(listChangedLines(repository, 'no-such-branch')).rejects.toThrow();
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe('reading of a git diff', () => {
  it('lists the changed lines of the new version of each file', () => {
    const diff = [
      'diff --git a/src/scene.cpp b/src/scene.cpp',
      'index 1111111..2222222 100644',
      '--- a/src/scene.cpp',
      '+++ b/src/scene.cpp',
      '@@ -6 +6,2 @@ namespace geo {',
      '-void Scene::add() {',
      '+void Scene::add(',
      '+    std::unique_ptr<Shape> shape) {',
      // Lines removed after line 12 of the new file.
      '@@ -14,3 +12,0 @@',
      '-  a;',
      '-  b;',
      '-  c;',
      'diff --git a/include/new file.h b/include/new file.h',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/include/new file.h\t',
      '@@ -0,0 +1,3 @@',
      '+class New {',
      '+};',
      '+',
      'diff --git a/old.h b/old.h',
      'deleted file mode 100644',
      '--- a/old.h',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-class Old {};',
      '-',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([
      {
        path: 'src/scene.cpp',
        ranges: [
          { firstLine: 6, lastLine: 7 },
          { firstLine: 12, lastLine: 13, deletionOnly: true },
        ],
      },
      { path: 'include/new file.h', ranges: [{ firstLine: 1, lastLine: 3 }] },
    ]);
  });
});
