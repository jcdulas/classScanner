// Tests of the method calls between classes (spec §3.1): what the parser reads of each call
// (src/parser/callReferences.ts) and which class each call goes to (src/model/callResolver.ts).

import { describe, expect, it } from 'vitest';
import { CallReference, ValueExpression } from '../../src/parser/fileSymbols';
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

/** A value as readable text: `<Type>`, `@attribute`, `this`, `receiver.name()`, `Scope::name()`, `receiver.member`, `?`. */
function describeValue(value: ValueExpression | undefined): string {
  if (value === undefined) {
    return '?';
  }
  switch (value.kind) {
    case 'this':
      return 'this';
    case 'attribute':
      return `@${value.name}`;
    case 'typed':
      return `<${value.type.name}>`;
    case 'address':
    case 'dereference':
      return `${value.kind === 'address' ? '&' : '*'}${describeValue(value.operand)}`;
    case 'call': {
      const owner = value.receiver !== undefined ? `${describeValue(value.receiver)}.` : value.scopeName !== undefined ? `${value.scopeName}::` : '';
      return `${owner}${value.name}(${value.arguments.map(describeValue).join(', ')})`;
    }
    case 'member':
      return `${describeValue(value.receiver)}.${value.name}`;
    case 'literal':
      return value.literal;
    case 'unknown':
      return '?';
  }
}

describe('expressions read by the parser', () => {
  it('keeps the shape of the object of a call, with local variables replaced by what is known of them', async () => {
    const symbols = await parseConstructFixture('expressions.cpp');
    const calls = symbols.outOfClassMethods[0].calls.filter((call) => call.receiverKind === 'expression');
    expect(calls.map((call) => `${describeValue(call.receiverValue)} -> ${call.name} @${call.line}`)).toEqual([
      // `job` is declared with `auto`: its value is what `nextJob()` returns.
      'nextJob() -> run @6',
      // `queue` is a parameter: its type is written.
      '<Queue>.front() -> run @7',
      // A chain: each call is made on what the call before it returns.
      'Registry::instance().find(string) -> stop @8',
      'Registry::instance() -> find @8',
      // The type is written in the template argument, in the cast, after `new`.
      '<Task> -> start @10',
      '<Worker> -> pause @11',
      '<Timer> -> reset @12',
      // `this->logger` is the attribute `logger`.
      '@logger.sink() -> flush @13',
      // The variable of a range-based for is an element of what it goes through.
      '<Queue>.items() -> cancel @15',
      // `copy` is declared with `auto` from `job`, itself declared with `auto`.
      'nextJob() -> abort @18',
      // An element of an attribute, and what a pointer points to: the value inside.
      '*@jobs -> resume @19',
      '*@current -> wake @20',
      // Nothing is known of what a lambda returns, nor of the result of an operator.
      'pick() -> skip @22',
      '? -> merge @23',
      // The arguments of a call, which tell its overloads apart: values written in the code,
      // a variable declared with `auto` and a variable with a written type.
      '@registry.find(integer, floating, character, boolean, null, string, nextJob(), <int>) -> stop @25',
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
        // Nothing tells what a lambda returns.
        '  auto pick = [this] { return first(); };',
        // `radius` only exists in Circle, among the classes that Scene has a relation to.
        '  pick()->radius();',
        // `draw` exists in Shape and in Circle: the call is dropped.
        '  pick()->draw();',
        // `size` exists in no project class.
        '  pick()->size();',
        '}',
      ].join('\n'),
    });
    expect(describeCalls(graph)).toEqual(['Scene::render -> Circle::radius @scene.cpp:3']);
  });

  it('trusts the type of an expression, even when it has no such method', async () => {
    const graph = await buildGraphFromSources({
      'scene.h': header,
      // `first()` returns a Circle, which has no `flush`: the call is not given to Logger,
      // although Logger is the only known class that has one.
      'scene.cpp': 'void Scene::render() {\n  first()->flush();\n  first()->draw();\n}',
    });
    expect(describeCalls(graph)).toEqual(['Scene::render -> Circle::draw @scene.cpp:3']);
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

describe('type of the expression that a method is called on', () => {
  const sources = {
    'tools.h': [
      'namespace tools {',
      'class Job { public: void run(); void stop(); };',
      'class Task { public: void run(); };',
      'class Queue { public: Job* front(); std::vector<Task> tasks(); };',
      'class Registry { public: static Registry& instance(); Job* find(const char* name); };',
      'class Base { protected: Queue queue; public: Task* current(); };',
      '}',
      // The prototype of a free function, whose code is not in the scanned files.
      'tools::Job* findJob();',
    ].join('\n'),
    'pool.h': [
      'class Pool : public tools::Base {',
      ' public:',
      '  tools::Job* nextJob();',
      '  std::map<int, tools::Job*> byId;',
      '  void fromOwnMethod(); void fromChain(); void fromMakeUnique(); void fromRangeFor(); void fromFreeFunction();',
      '  void fromContainer(); void fromBaseMethod(); void fromBaseAttribute(); void fromCast(void* pointer);',
      '};',
    ].join('\n'),
  };
  const callsOf = async (methodName: string, code: string) => {
    const graph = await buildGraphFromSources({ ...sources, 'pool.cpp': `void Pool::${methodName} {\n${code}\n}` });
    return graph.calls.map((call) => `${call.to}::${call.method} @${call.line}`);
  };

  it('follows a variable declared with auto to what gave it its value', async () => {
    expect(await callsOf('fromOwnMethod()', '  auto* job = nextJob();\n  auto* same = job;\n  same->run();')).toEqual(['tools::Job::run @4']);
  });

  it('follows a chain of calls through what each method returns', async () => {
    expect(await callsOf('fromChain()', '  tools::Registry::instance().find("a")->stop();')).toEqual([
      'tools::Job::stop @2',
      'tools::Registry::find @2',
      'tools::Registry::instance @2',
    ]);
  });

  it('reads the type written in make_unique, in a cast and after new', async () => {
    expect(await callsOf('fromMakeUnique()', '  auto task = std::make_unique<tools::Task>();\n  task->run();')).toEqual(['tools::Task::run @3']);
    expect(await callsOf('fromCast(void* pointer)', '  static_cast<tools::Job*>(pointer)->stop();\n  (new tools::Task())->run();')).toEqual([
      'tools::Job::stop @2',
      'tools::Task::run @3',
    ]);
  });

  it('gives the elements of a container the classes that its type names', async () => {
    // `queue` is an attribute of the base class, and `tasks()` returns a vector of Task.
    expect(await callsOf('fromRangeFor()', '  for (auto& item : queue.tasks()) {\n    item.run();\n  }')).toEqual([
      'tools::Queue::tasks @2',
      'tools::Task::run @3',
    ]);
    // `begin()` and `second` belong to the map and to its iterator: the classes stay those of the map.
    expect(await callsOf('fromContainer()', '  byId.begin()->second->run();')).toEqual(['tools::Job::run @2']);
  });

  it('uses the return type of a free function, of a method of a base class, and an attribute of a base class', async () => {
    expect(await callsOf('fromFreeFunction()', '  findJob()->stop();')).toEqual(['tools::Job::stop @2']);
    expect(await callsOf('fromBaseMethod()', '  current()->run();')).toEqual(['tools::Task::run @2', 'tools::Base::current @2']);
    expect(await callsOf('fromBaseAttribute()', '  queue.front()->run();')).toEqual(['tools::Job::run @2', 'tools::Queue::front @2']);
  });
});

describe('overload chosen by the arguments of a call', () => {
  const header = [
    'class Job { public: void run(); };',
    'class Task { public: void run(); };',
    'class Special : public Job {};',
    'class Registry {',
    ' public:',
    '  Job* find(int id);',
    '  Task* find(const std::string& name);',
    '  Job* pick(Job* job);',
    '  Task* pick(Task* task);',
    '  Job* make();',
    '  Task* make(int count, int priority = 0);',
    '  Job* log(bool enabled);',
    '  Task* log(const std::string& text);',
    '  Job* take(double ratio);',
    '  Task* take(const char* text);',
    '};',
    'class User {',
    ' public:',
    '  Registry registry;',
    '  void use();',
    '};',
  ].join('\n');
  /** The classes whose `run` is called by the code, which is the body of `User::use`. */
  const runCalledOn = async (code: string) => {
    const graph = await buildGraphFromSources({ 'registry.h': header, 'user.cpp': `void User::use() {\n${code}\n}` });
    return graph.calls.filter((call) => call.method === 'run').map((call) => call.to);
  };

  it('tells a number from a text', async () => {
    expect(await runCalledOn('  registry.find(42)->run();')).toEqual(['Job']);
    expect(await runCalledOn('  registry.find("name")->run();')).toEqual(['Task']);
  });

  it('uses the declared type of a variable given as an argument', async () => {
    expect(await runCalledOn('  int id = 1;\n  registry.find(id)->run();')).toEqual(['Job']);
    expect(await runCalledOn('  std::string name;\n  registry.find(name)->run();')).toEqual(['Task']);
  });

  it('gives an object to the parameter of its class, or of a base class of it', async () => {
    expect(await runCalledOn('  Task task;\n  registry.pick(&task)->run();')).toEqual(['Task']);
    // Special derives from Job: it can be given where a Job is expected, not where a Task is.
    expect(await runCalledOn('  Special special;\n  registry.pick(&special)->run();')).toEqual(['Job']);
  });

  it('counts the arguments, with the parameters that have a default value', async () => {
    expect(await runCalledOn('  registry.make()->run();')).toEqual(['Job']);
    expect(await runCalledOn('  registry.make(3)->run();')).toEqual(['Task']);
    expect(await runCalledOn('  registry.make(3, 1)->run();')).toEqual(['Task']);
  });

  it('distinguishes pointer and reference overloads throughout chained calls', async () => {
    const graph = await buildGraphFromSources({ 'overloads.cpp': [
      'struct A {}; struct Derived : A {};',
      'struct ObjectResult { void run(); }; struct PointerResult { void run(); };',
      'struct Registry { ObjectResult find(A&); PointerResult find(A*); };',
      'struct Client {',
      '  Registry r; A* field; A* get();',
      '  void pointer(A* p) { r.find(p).run(); }',
      '  void reference(A& a) { r.find(a).run(); }',
      '  void address(Derived& d) { r.find(&d).run(); }',
      '  void dereference(A* p) { r.find(*p).run(); }',
      '  void member() { r.find(field).run(); }',
      '  void returned() { auto p = get(); r.find(p).run(); }',
      '  void allocated() { r.find(new A).run(); }',
      '};',
    ].join('\n') });
    expect(graph.calls.filter((call) => call.method === 'run').map((call) => [call.fromMethod, call.to]).sort()).toEqual([
      ['address', 'PointerResult'], ['allocated', 'PointerResult'], ['dereference', 'ObjectResult'],
      ['member', 'PointerResult'], ['pointer', 'PointerResult'], ['reference', 'ObjectResult'], ['returned', 'PointerResult'],
    ]);
  });

  it('prefers a conversion of the language to one that a class defines', async () => {
    // A number becomes a `double` by itself; it cannot become a text.
    expect(await runCalledOn('  registry.take(1)->run();')).toEqual(['Job']);
    // A text between quotes becomes a `bool` by a conversion of the language, which wins over
    // the constructor of std::string: a well-known trap, that a compiler falls into too.
    expect(await runCalledOn('  registry.log("text")->run();')).toEqual(['Job']);
  });

  it('keeps every overload when the arguments do not tell them apart', async () => {
    expect(await runCalledOn('  registry.find(unknownValue())->run();')).toEqual(['Job', 'Task']);
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
