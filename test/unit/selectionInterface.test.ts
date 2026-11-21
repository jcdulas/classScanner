// Tests of the interface of a selection with the rest of the code (spec §4.8): what crosses its
// border (src/webview/model/selectionInterface.ts) and its text (src/webview/export/interfaceText.ts).

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInterfaceText } from '../../src/webview/export/interfaceText';
import { UsedClass, computeSelectionInterface, countFreeFunctionUsers, countUsers } from '../../src/webview/model/selectionInterface';
import { FIXTURES_DIRECTORY, buildGraphFromSources, scanTestFolder } from './testHelpers';

const PROJECT_FOLDER = path.join(FIXTURES_DIRECTORY, 'project');
const SELECTION = new Set(['geo::Scene', 'geo::Scene::Statistics', 'geo::Shape']);

/** The uses of each class as `kind user::member @file:line`, by used class. */
function describeClasses(classes: UsedClass[], files: string[]): Record<string, string[]> {
  const described: Record<string, string[]> = {};
  for (const usedClass of classes) {
    described[usedClass.id] = usedClass.uses.map((use) => {
      const kind = use.kind === 'call' ? `call ${use.calledMethod}` : use.kind;
      const member = use.userMember === undefined ? '' : `::${use.userMember}`;
      return `${kind} ${use.userId}${member} @${files[use.file]}:${use.line}`;
    });
  }
  return described;
}

describe('interface of a selection', () => {
  it('lists what the rest of the code uses of the selection', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const result = computeSelectionInterface(graph, SELECTION);
    expect(describeClasses(result.usedBy, graph.files)).toEqual({
      'geo::Scene': [
        'aggregate geo::Layer::owner @include/geometry/scene.h:30',
        'depend geo::Renderer::render @src/renderer.h:10',
        // Scene declares SceneInspector as a friend: it is SceneInspector that can use Scene.
        'friend geo::SceneInspector @include/geometry/scene.h:24',
      ],
      'geo::Shape': [
        'inherit geo::Circle @include/geometry/shape.h:25',
        'inherit geo::Polygon @include/geometry/shape.h:33',
        'include geo::Renderer @src/renderer.h:2',
      ],
    });
    expect(countUsers(result.usedBy)).toBe(5);
    // Statistics is only used by Scene, which is in the selection.
    expect(result.internalIds).toEqual(['geo::Scene::Statistics']);
  });

  it('lists what the selection uses of the rest of the code, with the calls', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const result = computeSelectionInterface(graph, SELECTION);
    expect(describeClasses(result.uses, graph.files)).toEqual({
      'geo::Canvas': ['depend geo::Shape::draw @include/geometry/shape.h:19'],
      'geo::Layer': ['aggregate geo::Scene::layers @include/geometry/scene.h:21'],
      'geo::Logger': ['depend geo::Scene::add @src/scene.cpp:8', 'call log geo::Scene::add @src/scene.cpp:8'],
      'geo::Point': ['compose geo::Shape::origin @include/geometry/shape.h:22'],
      'geo::Renderer': ['depend geo::Scene::add @src/scene.cpp:7', 'include geo::Scene @src/scene.cpp:2'],
    });
  });

  it('leaves out what stays inside the selection', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const everything = new Set(graph.nodes.map((node) => node.id));
    const result = computeSelectionInterface(graph, everything);
    expect(result.usedBy).toEqual([]);
    expect(result.uses).toEqual([]);
    expect(result.internalIds).toHaveLength(graph.nodes.length);
  });

  it('lists every declaration of a relation', async () => {
    const graph = await buildGraphFromSources({
      'tool.h': 'class Pen {};\nclass Tool {\n  Pen first;\n  Pen second;\n};',
    });
    const result = computeSelectionInterface(graph, new Set(['Pen']));
    expect(describeClasses(result.usedBy, graph.files)).toEqual({
      Pen: ['compose Tool::first @tool.h:3', 'compose Tool::second @tool.h:4'],
    });
  });
});

describe('free functions in the interface of a selection', () => {
  const sources = {
    'scene.h': 'class Shape { public: double area(); };\nclass Scene { public: void add(Shape* shape); };\nclass Logger { public: static void log(); };',
    // A helper next to the methods of Scene, and the method that makes scene.cpp a file of Scene.
    'scene.cpp': '#include "scene.h"\nstatic void trace(Shape* shape) {\n  Logger::log();\n}\nvoid Scene::add(Shape* shape) {}',
    'main.cpp': '#include "scene.h"\nnamespace app {\nint run() {\n  Scene scene;\n  scene.add(nullptr);\n  return 0;\n}\n}',
  };

  it('lists the uses by functions of other files, and counts a class as used', async () => {
    const graph = await buildGraphFromSources(sources);
    const result = computeSelectionInterface(graph, new Set(['Scene']));
    expect(describeClasses(result.usedBy, graph.files)).toEqual({
      Scene: ['depend app::run() @main.cpp:4', 'call add app::run() @main.cpp:5'],
    });
    expect(countUsers(result.usedBy)).toBe(0);
    expect(countFreeFunctionUsers(result.usedBy)).toBe(1);
    expect(result.internalIds).toEqual([]);
  });

  it('takes a function written in a file of a selected class as part of the selection', async () => {
    const graph = await buildGraphFromSources(sources);
    const result = computeSelectionInterface(graph, new Set(['Scene']));
    // `trace` is in scene.cpp, which defines a method of Scene: what it uses is used by the selection.
    expect(describeClasses(result.uses, graph.files)).toEqual({
      Logger: ['depend trace() @scene.cpp:3', 'call log trace() @scene.cpp:3'],
      Shape: ['depend Scene::add @scene.cpp:5', 'depend Scene::add @scene.h:2', 'depend trace() @scene.cpp:2'],
    });
  });
});

describe('text of the interface', () => {
  it('writes both directions, one line per use', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const text = buildInterfaceText(graph, SELECTION, computeSelectionInterface(graph, SELECTION), 'project');
    expect(text.split('\n')).toEqual([
      '# Interface of 3 classes of project with the rest of the code, exported by classScanner.',
      '# Classes: geo::Scene, geo::Scene::Statistics, geo::Shape',
      '# Each line is one use: its kind, the class and the member that uses (or the free function, with `()`), and [file:line].',
      '# Calls are found without a compiler: some are missed, and a few may be wrong.',
      '',
      'used by the rest of the code: 2 of 3 classes, used by 5 classes',
      '  geo::Scene',
      '    aggregation  geo::Layer::owner  [include/geometry/scene.h:30]',
      '    dependency   geo::Renderer::render  [src/renderer.h:10]',
      '    friend       geo::SceneInspector  [include/geometry/scene.h:24]',
      '  geo::Shape',
      '    inheritance  geo::Circle  [include/geometry/shape.h:25]',
      '    inheritance  geo::Polygon  [include/geometry/shape.h:33]',
      '    include      geo::Renderer  [src/renderer.h:2]',
      '',
      'uses of the rest of the code: 5 classes',
      '  geo::Canvas',
      '    dependency  geo::Shape::draw  [include/geometry/shape.h:19]',
      '  geo::Layer',
      '    aggregation  geo::Scene::layers  [include/geometry/scene.h:21]',
      '  geo::Logger',
      '    dependency     geo::Scene::add  [src/scene.cpp:8]',
      '    call of log()  geo::Scene::add  [src/scene.cpp:8]',
      '  geo::Point',
      '    composition  geo::Shape::origin  [include/geometry/shape.h:22]',
      '  geo::Renderer',
      '    dependency  geo::Scene::add  [src/scene.cpp:7]',
      '    include     geo::Scene  [src/scene.cpp:2]',
      '',
      'not used from outside: geo::Scene::Statistics',
      '',
    ]);
  });
});
