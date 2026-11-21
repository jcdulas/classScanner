// Tests of the method calls between classes (spec §3.1): what the parser reads of each call
// (src/parser/callReferences.ts) and which class each call goes to (src/model/callResolver.ts).

import { describe, expect, it } from 'vitest';
import { CallReference } from '../../src/parser/fileSymbols';
import { Graph } from '../../src/shared/graphModel';
import { buildGraphFromSources, parseConstructFixture } from './testHelpers';

/** A call as readable text: `kind receiver: type . name @line`. */
function describeCall(call: CallReference): string {
  const receiver = call.receiverName === undefined ? '' : ` ${call.receiverName}`;
  const type = call.receiverType === undefined ? '' : `: ${call.receiverType.name}`;
  return `${call.receiverKind}${receiver}${type} . ${call.name} @${call.line}`;
}

/** The calls of a graph as `From::method -> To::method @file:line`. */
function describeCalls(graph: Graph): string[] {
  return graph.calls.map((call) => `${call.from}::${call.fromMethod} -> ${call.to}::${call.method} @${graph.files[call.file]}:${call.line}`);
}

describe('calls read by the parser', () => {
  it('reads the name of each call and what it is called on', async () => {
    const symbols = await parseConstructFixture('calls.cpp');
    const run = symbols.outOfClassMethods[0];
    expect(run.name).toBe('run');
    expect(run.calls.map(describeCall)).toEqual([
      // A plain call: a method of the class itself or of a base class, or a free function.
      'own . makeFactory @6',
      // A local variable and two parameters, with their declared types.
      'variable timer: Timer . start @7',
      'variable scene: Scene . add @8',
      'variable shape: Shape . draw @9',
      // Not declared in the method: attributes of the class.
      'variable renderer . render @10',
      'variable logger . write @11',
      // `this->update()` and `update()` are the same call, kept once.
      'own . update @12',
      // The object of `flush` is the result of another call.
      'expression . flush @14',
      'scope Registry . instance @14',
      // `factory` is declared with `auto`: its type is not written.
      'expression . create @15',
      'variable scene: Scene . layers @17',
      // The variable of a range-based for loop, and a method called with template arguments.
      'variable layer: Layer . show @18',
    ]);
  });
});

describe('class that a call goes to', () => {
  const header = [
    'class Shape { public: virtual void draw(); };',
    'class Circle : public Shape { public: double radius(); };',
    'class Logger { public: static void log(); void flush(); };',
    'class Scene {',
    'public:',
    '  void add(Shape* shape);',
    '  void render();',
    '  Circle* first();',
    '  Circle circle;',
    '  std::unique_ptr<Logger> logger;',
    '};',
  ].join('\n');

  it('follows the type of a parameter, of a local variable and of an attribute', async () => {
    const graph = await buildGraphFromSources({
      'scene.h': header,
      'scene.cpp': [
        'void Scene::add(Shape* shape) {',
        '  shape->draw();',
        '  Circle local;',
        '  local.radius();',
        '  logger->flush();',
        '}',
      ].join('\n'),
    });
    expect(describeCalls(graph)).toEqual([
      'Scene::add -> Shape::draw @scene.cpp:2',
      'Scene::add -> Circle::radius @scene.cpp:4',
      // The attribute is a `std::unique_ptr<Logger>`: the class is found in the template arguments.
      'Scene::add -> Logger::flush @scene.cpp:5',
    ]);
  });

  it('accepts a method declared by a base class of the object', async () => {
    const graph = await buildGraphFromSources({
      'scene.h': header,
      'scene.cpp': 'void Scene::render() {\n  circle.draw();\n}',
    });
    // `draw` is declared by Shape, but the object is a Circle: the call goes to Circle.
    expect(describeCalls(graph)).toEqual(['Scene::render -> Circle::draw @scene.cpp:2']);
  });

  it('follows a class named before `::`', async () => {
    const graph = await buildGraphFromSources({
      'scene.h': header,
      'scene.cpp': 'void Scene::render() {\n  Logger::log();\n  Logger::missing();\n  std::sort();\n}',
    });
    expect(describeCalls(graph)).toEqual(['Scene::render -> Logger::log @scene.cpp:2']);
  });

  it('sends a call of an inherited method to the base class', async () => {
    const graph = await buildGraphFromSources({
      'shape.h': header,
      'circle.cpp': 'double Circle::radius() {\n  draw();\n  this->draw();\n  radius();\n  return 0;\n}',
    });
    // `radius()` is a call inside the class: it is not a call between classes.
    expect(describeCalls(graph)).toEqual(['Circle::radius -> Shape::draw @circle.cpp:2']);
  });

  it('keeps a call on an unknown object only when one known class has the method', async () => {
    const graph = await buildGraphFromSources({
      'scene.h': header,
      'scene.cpp': [
        'void Scene::render() {',
        // `radius` only exists in Circle, among the classes that Scene has a relation to.
        '  first()->radius();',
        // `draw` exists in Shape and in Circle: the call is dropped.
        '  first()->draw();',
        // `size` exists in no project class.
        '  first()->size();',
        '}',
      ].join('\n'),
    });
    expect(describeCalls(graph)).toEqual(['Scene::render -> Circle::radius @scene.cpp:2']);
  });

  it('drops a call on an object whose type is not a project class', async () => {
    const graph = await buildGraphFromSources({
      'scene.h': header,
      'scene.cpp': 'void Scene::render() {\n  std::string radius;\n  radius.draw();\n}',
    });
    expect(describeCalls(graph)).toEqual([]);
  });

  it('trusts the source for a class that is only forward-declared', async () => {
    const graph = await buildGraphFromSources({
      'tool.h': 'class Canvas;\nclass Tool {\npublic:\n  void paint(Canvas& canvas) { canvas.clear(); }\n};',
    });
    expect(describeCalls(graph)).toEqual(['Tool::paint -> Canvas::clear @tool.h:4']);
  });

  it('reads the calls of methods defined inside the class', async () => {
    const graph = await buildGraphFromSources({
      'tool.h': 'class Pen { public: void down(); };\nclass Tool {\n  Pen pen;\n  void start() { pen.down(); }\n};',
    });
    expect(describeCalls(graph)).toEqual(['Tool::start -> Pen::down @tool.h:4']);
  });
});

describe('declarations of a relation', () => {
  it('lists every line that declares a relation, with the member that creates it', async () => {
    const graph = await buildGraphFromSources({
      'tool.h': [
        'class Pen {};',
        'class Tool {',
        '  Pen first;',
        '  Pen second;',
        '  void take(Pen& pen);',
        '};',
        'class User {',
        '  void use(Pen& pen);',
        '  void drop() { Pen spare; }',
        '};',
      ].join('\n'),
    });
    const describe = (from: string, kind: string) =>
      graph.edges
        .find((edge) => edge.from === from && edge.kind === kind)
        ?.declarations.map((declaration) => `${declaration.member}@${declaration.line}`);
    expect(describe('Tool', 'compose')).toEqual(['first@3', 'second@4']);
    // The dependency of Tool on Pen is implied by its composition: it is not a relation of its own.
    expect(describe('Tool', 'depend')).toBeUndefined();
    expect(describe('User', 'depend')).toEqual(['use@8', 'drop@9']);
  });
});
