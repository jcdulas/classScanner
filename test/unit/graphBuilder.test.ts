// Tests of name resolution and relation detection on whole projects.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURES_DIRECTORY,
  buildGraphFromSources,
  buildGraphResultFromSources,
  describeEdgeLocations,
  describeEdges,
  scanTestFolder,
} from './testHelpers';

const PROJECT_FOLDER = path.join(FIXTURES_DIRECTORY, 'project');

describe('fixture project', () => {
  it('finds every class, with nested and forward-declared ones', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const ids = graph.nodes.map((node) => node.id).sort();
    expect(ids).toEqual([
      'TopLevel',
      'geo::Canvas',
      'geo::Circle',
      'geo::Layer',
      'geo::Logger',
      'geo::Point',
      'geo::Polygon',
      'geo::Renderer',
      'geo::Scene',
      'geo::Scene::Statistics',
      'geo::SceneInspector',
      'geo::Shape',
    ]);
    expect(graph.nodes.find((node) => node.id === 'geo::Canvas')?.isExternal).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'geo::Shape')?.isAbstract).toBe(true);
  });

  it('detects inheritance, composition, aggregation, friends and nesting', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const edges = describeEdges(graph.edges);
    expect(edges).toEqual(
      expect.arrayContaining([
        'inherit geo::Circle -> geo::Shape (public)',
        'inherit geo::Polygon -> geo::Shape (public)',
        'compose geo::Shape -> geo::Point (1)',
        'compose geo::Polygon -> geo::Point (*)',
        // Through the alias `ShapeList = std::vector<std::unique_ptr<Shape>>`.
        'compose geo::Scene -> geo::Shape (*)',
        'aggregate geo::Scene -> geo::Layer (*)',
        'compose geo::Scene -> geo::Scene::Statistics (1)',
        'aggregate geo::Layer -> geo::Scene (1)',
        'friend geo::Scene -> geo::SceneInspector',
        'nest geo::Scene -> geo::Scene::Statistics',
      ]),
    );
  });

  it('detects dependencies in signatures and in method bodies of .cpp files', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const edges = describeEdges(graph.edges);
    expect(edges).toEqual(
      expect.arrayContaining([
        'depend geo::Shape -> geo::Canvas',
        'depend geo::Renderer -> geo::Scene',
        'depend geo::Scene -> geo::Renderer',
        'depend geo::Scene -> geo::Logger',
      ]),
    );
  });

  it('drops self relations and dependencies implied by stronger relations', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const edges = describeEdges(graph.edges);
    expect(edges).not.toContain('aggregate geo::Scene -> geo::Scene (1)');
    expect(edges).not.toContain('depend geo::Scene -> geo::Layer');
    expect(edges).not.toContain('depend geo::Scene -> geo::Shape');
  });

  it('draws each include once, between the main classes of the two files', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    const includes = describeEdges(graph.edges.filter((edge) => edge.kind === 'include')).sort();
    expect(includes).toEqual([
      // renderer.h includes <geometry/shape.h>, found by path suffix. The main class of
      // shape.h is Shape, named like the file, although Point is declared first.
      'include geo::Renderer -> geo::Shape',
      // scene.cpp defines methods of Scene and includes "renderer.h".
      'include geo::Scene -> geo::Renderer',
      // scene.h includes "shape.h", relative to its own folder.
      'include geo::Scene -> geo::Shape',
    ]);
  });

  it('records where each relation is declared', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    expect(describeEdgeLocations(graph)).toEqual(
      expect.arrayContaining([
        // The base class in the list of bases.
        'inherit geo::Circle -> geo::Shape: include/geometry/shape.h:25',
        // The attribute.
        'compose geo::Shape -> geo::Point: include/geometry/shape.h:22',
        'aggregate geo::Scene -> geo::Layer: include/geometry/scene.h:21',
        // The method, for a type of its parameters.
        'depend geo::Shape -> geo::Canvas: include/geometry/shape.h:19',
        // The line of code, for a type used in the body of a method.
        'depend geo::Scene -> geo::Renderer: src/scene.cpp:7',
        'depend geo::Scene -> geo::Logger: src/scene.cpp:8',
        'include geo::Scene -> geo::Renderer: src/scene.cpp:2',
        'friend geo::Scene -> geo::SceneInspector: include/geometry/scene.h:24',
        // The declaration of the nested class.
        'nest geo::Scene -> geo::Scene::Statistics: include/geometry/scene.h:16',
      ]),
    );
  });

  it('gives each base class of a list its own line', async () => {
    const graph = await buildGraphFromSources({
      'derived.h': 'class First {};\nclass Second {};\nclass Derived :\n  public First,\n  public Second {};',
    });
    expect(describeEdgeLocations(graph)).toEqual([
      'inherit Derived -> First: derived.h:4',
      'inherit Derived -> Second: derived.h:5',
    ]);
  });

  it('builds a scan report', async () => {
    const { report } = await scanTestFolder(PROJECT_FOLDER);
    expect(report.scannedFileCount).toBe(5);
    expect(report.parseErrorCount).toBe(0);
    expect(report.nodeCount).toBe(12);
    expect(report.edgeCounts.inherit).toBe(2);
    // std::string, std::move and the like are external, not unresolved.
    expect(report.unresolvedTypeReferenceCount).toBe(0);
  });
});

describe('file discovery', () => {
  it('skips excluded folders', async () => {
    const { graph } = await scanTestFolder(PROJECT_FOLDER);
    expect(graph.files).not.toContain('build/generated.h');
  });

  it('honors the depth limit', async () => {
    const depthZero = await scanTestFolder(PROJECT_FOLDER, { maxDepth: 0 });
    expect(depthZero.graph.files).toEqual(['top.hpp']);
    const depthOne = await scanTestFolder(PROJECT_FOLDER, { maxDepth: 1 });
    expect(depthOne.graph.files).toEqual(['src/renderer.h', 'src/scene.cpp', 'top.hpp']);
  });

  it('lists files above the size limit', async () => {
    const { report } = await scanTestFolder(PROJECT_FOLDER, { maxFileSizeBytes: 200 });
    expect(report.skippedLargeFiles).toContain('include/geometry/shape.h');
  });
});

describe('merging', () => {
  it('merges a class declared in several #if branches', async () => {
    const graph = await buildGraphFromSources({
      'backend.h': '#ifdef GPU\nclass Backend { GpuContext gpu; };\n#else\nclass Backend { CpuContext cpu; };\n#endif',
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].attributes.map((attribute) => attribute.name)).toEqual(['gpu', 'cpu']);
  });

  it('lists template specializations on the primary template', async () => {
    const graph = await buildGraphFromSources({
      'buffer.h': 'template <typename T> class Buffer {};\ntemplate <> class Buffer<bool> {};',
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].templateParams).toEqual(['T']);
    expect(graph.nodes[0].specializations).toEqual(['Buffer<bool>']);
  });
});

describe('name resolution', () => {
  it('resolves names from the innermost scope outward', async () => {
    const graph = await buildGraphFromSources({
      'a.h': 'namespace a { class Item {}; namespace b { class Item {}; class User { Item item; }; } }',
    });
    expect(describeEdges(graph.edges)).toEqual(['compose a::b::User -> a::b::Item (1)']);
  });

  it('uses using-namespace directives', async () => {
    const graph = await buildGraphFromSources({
      'lib.h': 'namespace lib { class Engine {}; } namespace other { class Engine {}; }',
      'app.h': 'using namespace lib;\nclass App { Engine* engine; };',
    });
    expect(describeEdges(graph.edges)).toEqual(['aggregate App -> lib::Engine (1)']);
  });

  it('falls back to a unique short name', async () => {
    const graph = await buildGraphFromSources({
      'a.h': 'namespace deep::inside { class Widget {}; }',
      'b.h': 'class Window { Widget main; };',
    });
    expect(describeEdges(graph.edges)).toEqual(['compose Window -> deep::inside::Widget (1)']);
  });

  it('never resolves template parameters to project classes', async () => {
    const graph = await buildGraphFromSources({
      'a.h': 'class T {};\ntemplate <typename T> class Holder { T value; };',
    });
    expect(graph.edges).toEqual([]);
  });

  it('counts unresolved names, but not standard library types', async () => {
    const result = await buildGraphResultFromSources({
      'a.h': 'class User { Missing value; Missing other; std::string name; void f(Unknown u); };',
    });
    expect(result.graph.edges).toEqual([]);
    expect(Array.from(result.unresolvedTypeNames)).toEqual([
      ['Unknown', 1],
      ['Missing', 2],
    ]);
  });
});

describe('composition and aggregation rules', () => {
  it('classifies members by ownership and multiplicity', async () => {
    const graph = await buildGraphFromSources({
      'a.h': [
        'class Part {}; class Key {}; class Value {};',
        'class Whole {',
        '  Part byValue;',
        '  std::unique_ptr<Part> owned;',
        '  std::shared_ptr<Value> shared;',
        '  Value& borrowed;',
        '  std::map<Key, std::shared_ptr<Value>> lookup;',
        '  Part parts[3];',
        '};',
      ].join('\n'),
    });
    expect(describeEdges(graph.edges).sort()).toEqual([
      'aggregate Whole -> Value (*)',
      'compose Whole -> Key (*)',
      'compose Whole -> Part (*)',
    ]);
  });
});
