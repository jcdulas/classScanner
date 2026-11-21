// Tests of the exports of selected classes: source files for the .zip archive and the schema for language models.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, zipEntryNames } from '../../src/model/sourceFiles';
import { ClassNode, Graph } from '../../src/shared/graphModel';
import { DEFAULT_SCHEMA_DETAIL, SchemaDetail } from '../../src/shared/savedState';
import { buildLlmSchema, estimateTokenCount } from '../../src/webview/export/llmSchema';
import { FIXTURES_DIRECTORY, scanTestFolder } from './testHelpers';

function makeNode(id: string, file: number, definitionFiles?: number[]): ClassNode {
  return {
    id,
    name: id.split('::').pop()!,
    kind: 'class',
    namespace: id.includes('::') ? id.slice(0, id.lastIndexOf('::')) : '',
    file,
    line: 1,
    definitionFiles,
    isAbstract: false,
    isExternal: false,
    attributes: [],
    methods: [],
  };
}

describe('source files of classes', () => {
  // Headers and sources in two top folders with the same tree, as in many C++ projects.
  const graph: Graph = {
    root: '/project',
    files: ['inc/core/engine.h', 'inc/core/util.h', 'inc/net/util.h', 'src/core/engine.cpp', 'src/core/util.cpp', 'src/net/socket.cpp', 'src/main.cpp'],
    nodes: [makeNode('Engine', 0), makeNode('CoreUtil', 1), makeNode('NetUtil', 2, [5])],
    edges: [],
    calls: [], functionUses: [],
  };

  it('finds the .cpp file in a mirror tree under another top folder', () => {
    expect(collectSourceFiles(graph, ['Engine'])).toEqual(['inc/core/engine.h', 'src/core/engine.cpp']);
  });

  it('adds the files that define the methods of the class', () => {
    expect(collectSourceFiles(graph, ['NetUtil'])).toEqual(['inc/net/util.h', 'src/net/socket.cpp']);
  });

  it('lists each file once for several classes', () => {
    expect(collectSourceFiles(graph, ['Engine', 'CoreUtil'])).toEqual([
      'inc/core/engine.h',
      'inc/core/util.h',
      'src/core/engine.cpp',
      'src/core/util.cpp',
    ]);
  });

  it('finds a .cpp file next to its header', () => {
    const sideBySide: Graph = { ...graph, files: ['core/engine.h', 'core/engine.cpp'], nodes: [makeNode('Engine', 0)] };
    expect(collectSourceFiles(sideBySide, ['Engine'])).toEqual(['core/engine.cpp', 'core/engine.h']);
  });

  const graphOf = (files: string[]): Graph => ({ root: '/project', files, nodes: [makeNode('Engine', 0)], edges: [], calls: [], functionUses: [] });

  it('finds the .cpp file when the header tree has an extra folder level', () => {
    const extraLevel = graphOf(['include/myproject/engine.h', 'src/engine.cpp', 'src/other.cpp']);
    expect(collectSourceFiles(extraLevel, ['Engine'])).toEqual(['include/myproject/engine.h', 'src/engine.cpp']);
  });

  it('prefers the file whose folders resemble most those of the header', () => {
    const severalCandidates = graphOf(['include/myproject/core/engine.h', 'src/core/engine.cpp', 'src/net/engine.cpp']);
    expect(collectSourceFiles(severalCandidates, ['Engine'])).toEqual(['include/myproject/core/engine.h', 'src/core/engine.cpp']);
  });

  it('takes no companion when several files match equally and share no folder', () => {
    const ambiguous = graphOf(['inc/engine.h', 'src/engine.cpp', 'tests/engine.cpp']);
    expect(collectSourceFiles(ambiguous, ['Engine'])).toEqual(['inc/engine.h']);
  });

  it('takes other headers with the same name, such as inline files', () => {
    const inlineFile = graphOf(['core/engine.h', 'core/engine.inl', 'core/engine.cpp']);
    expect(collectSourceFiles(inlineFile, ['Engine'])).toEqual(['core/engine.cpp', 'core/engine.h', 'core/engine.inl']);
  });

  it('records the definition files during the scan', async () => {
    const { graph: scanned } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
    const scene = scanned.nodes.find((node) => node.id === 'geo::Scene')!;
    expect(scene.definitionFiles?.map((index) => scanned.files[index])).toEqual(['src/scene.cpp']);
    expect(collectSourceFiles(scanned, ['geo::Scene'])).toEqual(['include/geometry/scene.h', 'src/scene.cpp']);
  });
});

describe('names of the files in the archive', () => {
  const files = ['inc/core/util.h', 'inc/net/util.h', 'src/core/engine.cpp'];

  it('keeps the folder tree', () => {
    expect(Array.from(zipEntryNames(files, 'tree').values())).toEqual(files);
  });

  it('flattens the tree and keeps files with the same name apart', () => {
    expect(Array.from(zipEntryNames(files, 'flat').values())).toEqual(['inc_core_util.h', 'inc_net_util.h', 'engine.cpp']);
  });
});

describe('schema for language models', () => {
  it('writes classes by namespace, with bases, members, locations and relations', async () => {
    const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
    const schema = buildLlmSchema(graph, ['geo::Shape', 'geo::Circle', 'geo::Polygon', 'geo::Point'], {
      projectName: 'project',
      relationKinds: new Set(['inherit', 'compose', 'depend']),
      detail: DEFAULT_SCHEMA_DETAIL,
    });
    const body = schema.split('\n').filter((line) => !line.startsWith('#') && line !== '');
    expect(body).toEqual([
      'namespace geo',
      '  class Circle : public geo::Shape  [include/geometry/shape.h:25]',
      '    - radius: double',
      '    + virtual area() const: double',
      '  class Point  [include/geometry/shape.h:9]',
      '    + x: double',
      '    + y: double',
      '  class Polygon : public geo::Shape  [include/geometry/shape.h:33]',
      '    - vertices: std::vector<Point>',
      '    + virtual area() const: double',
      '  abstract class Shape  [include/geometry/shape.h:15]',
      '    # origin: Point',
      '    + virtual ~Shape()',
      '    + virtual area() const: double = 0',
      '    + virtual draw(Canvas& canvas) const: void',
      'relations',
      '  geo::Polygon *-- geo::Point [*]',
      '  geo::Shape *-- geo::Point',
      'relations to classes outside this schema',
      '  geo::Shape ..> geo::Canvas',
      'relations from classes outside this schema',
      '  geo::Scene *-- geo::Shape [*]',
    ]);
    expect(schema.startsWith('# C++ class schema of project (4 classes)')).toBe(true);
  });

  it('lists the classes outside the schema that derive from its classes', async () => {
    const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
    const schema = buildLlmSchema(graph, ['geo::Shape'], {
      projectName: 'project',
      relationKinds: new Set(['inherit']),
      detail: DEFAULT_SCHEMA_DETAIL,
    });
    const lines = schema.split('\n');
    const start = lines.indexOf('relations from classes outside this schema');
    expect(lines.slice(start + 1, start + 3)).toEqual(['  geo::Circle --|> geo::Shape', '  geo::Polygon --|> geo::Shape']);
  });

  it('refuses an empty selection', () => {
    const graph: Graph = { root: '/p', files: [], nodes: [], edges: [], calls: [], functionUses: [] };
    expect(() => buildLlmSchema(graph, [], { projectName: 'p', relationKinds: new Set(), detail: DEFAULT_SCHEMA_DETAIL })).toThrow(
      'No class to export.',
    );
  });

  describe('lighter schemas', () => {
    const shapeLines = async (detail: SchemaDetail) => {
      const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
      const schema = buildLlmSchema(graph, ['geo::Shape', 'geo::Circle'], { projectName: 'project', relationKinds: new Set(), detail });
      return schema.split('\n').filter((line) => line !== '');
    };

    it('leaves out private members and says so', async () => {
      const lines = await shapeLines({ members: 'nonPrivate', includeLocations: true });
      expect(lines).toContain('# Private members are left out.');
      expect(lines).toContain('    # origin: Point');
      expect(lines).not.toContain('    - radius: double');
    });

    it('lists public members only', async () => {
      const lines = await shapeLines({ members: 'public', includeLocations: true });
      expect(lines).toContain('# Only public members are listed.');
      expect(lines).not.toContain('    # origin: Point');
      expect(lines).toContain('    + virtual area() const: double = 0');
    });

    it('lists classes and relations only, without the legend of members', async () => {
      const lines = await shapeLines({ members: 'none', includeLocations: true });
      expect(lines.some((line) => line.startsWith('# Members: +'))).toBe(false);
      expect(lines.filter((line) => !line.startsWith('#'))).toEqual([
        'namespace geo',
        '  class Circle : public geo::Shape  [include/geometry/shape.h:25]',
        '  abstract class Shape  [include/geometry/shape.h:15]',
      ]);
    });

    it('leaves out the file locations', async () => {
      const lines = await shapeLines({ members: 'none', includeLocations: false });
      expect(lines.filter((line) => !line.startsWith('#'))).toEqual([
        'namespace geo',
        '  class Circle : public geo::Shape',
        '  abstract class Shape',
      ]);
    });

    it('gets shorter with each option, on a whole project', async () => {
      const { graph } = await scanTestFolder(path.join(FIXTURES_DIRECTORY, 'project'));
      const everyClass = graph.nodes.map((node) => node.id);
      const sizeOf = async (detail: SchemaDetail) =>
        estimateTokenCount(buildLlmSchema(graph, everyClass, { projectName: 'project', relationKinds: new Set(), detail }));
      const complete = await sizeOf({ members: 'all', includeLocations: true });
      const withoutPrivate = await sizeOf({ members: 'nonPrivate', includeLocations: true });
      const publicOnly = await sizeOf({ members: 'public', includeLocations: true });
      const classesOnly = await sizeOf({ members: 'none', includeLocations: false });
      expect(withoutPrivate).toBeLessThan(complete);
      expect(publicOnly).toBeLessThan(withoutPrivate);
      expect(classesOnly).toBeLessThan(publicOnly);
    });
  });
});
