// Tests of the scan of a folder together with its paired header or source folder (spec §2.2),
// and of what it gives: links between the files of the two trees, and two files to open per class.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IncludeResolver } from '../../src/model/includeResolver';
import { findPairedFolder } from '../../src/scanner/pairedFolder';
import { ClassNode, CodeSide, Graph, Member } from '../../src/shared/graphModel';
import { codeLocationOf, openTargetsOf, otherCodeSide } from '../../src/webview/model/openTargets';
import { FIXTURES_DIRECTORY, buildGraphFromSources, describeEdges, scanTestFolder } from './testHelpers';

// inc/core, inc/net, src/core, src/net and src/tools, which has no counterpart under inc/.
const PAIRED_PROJECT = path.join(FIXTURES_DIRECTORY, 'paired');

function nodeOf(graph: Graph, id: string): ClassNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    throw new Error(`Class ${id} not found. Known classes: ${graph.nodes.map((candidate) => candidate.id).join(', ')}`);
  }
  return node;
}

describe('paired folder', () => {
  it('pairs a subfolder of src with the same subfolder of inc', async () => {
    const paired = await findPairedFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    expect(paired).toEqual({ folder: path.join(PAIRED_PROJECT, 'inc', 'core'), commonParent: PAIRED_PROJECT });
  });

  it('pairs in the other direction, and the src or inc folder itself', async () => {
    expect((await findPairedFolder(path.join(PAIRED_PROJECT, 'inc', 'net')))?.folder).toBe(path.join(PAIRED_PROJECT, 'src', 'net'));
    expect((await findPairedFolder(path.join(PAIRED_PROJECT, 'inc')))?.folder).toBe(path.join(PAIRED_PROJECT, 'src'));
  });

  it('finds no pair when the counterpart folder does not exist', async () => {
    expect(await findPairedFolder(path.join(PAIRED_PROJECT, 'src', 'tools'))).toBeUndefined();
  });

  it('finds no pair for a folder that is not under a source or header folder', async () => {
    expect(await findPairedFolder(PAIRED_PROJECT)).toBeUndefined();
  });
});

describe('scan of a paired folder', () => {
  it('scans the two folders, with paths relative to their common parent', async () => {
    const { graph, report } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    expect(graph.root).toBe(PAIRED_PROJECT);
    expect(graph.files).toEqual(['inc/core/engine.h', 'inc/core/util.h', 'src/core/engine.cpp', 'src/core/util.cpp']);
    expect(report.folder).toBe(path.join(PAIRED_PROJECT, 'src', 'core'));
    expect(report.pairedFolder).toBe(path.join(PAIRED_PROJECT, 'inc', 'core'));
    expect(report.scannedFileCount).toBe(4);
  });

  it('gives the same graph from either side of the pair', async () => {
    const fromSources = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    const fromHeaders = await scanTestFolder(path.join(PAIRED_PROJECT, 'inc', 'core'));
    expect(fromHeaders.graph).toEqual(fromSources.graph);
  });

  it('attaches the methods defined in the source folder to the class of the header folder', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    const engine = nodeOf(graph, 'app::Engine');
    expect(graph.files[engine.file]).toBe('inc/core/engine.h');
    expect(engine.definitionFiles?.map((index) => graph.files[index])).toEqual(['src/core/engine.cpp']);
    expect(describeEdges(graph.edges)).toContain('compose app::Engine -> app::Timer (1)');
  });

  it('applies the depth to both folders', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src'), { maxDepth: 0 });
    expect(graph.files).toEqual([]);
    const oneLevel = await scanTestFolder(path.join(PAIRED_PROJECT, 'src'), { maxDepth: 1 });
    expect(oneLevel.graph.files).toHaveLength(8);
  });

  it('scans a folder without a pair alone', async () => {
    const { graph, report } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'tools'));
    expect(graph.root).toBe(path.join(PAIRED_PROJECT, 'src', 'tools'));
    expect(graph.files).toEqual(['cli.cpp']);
    expect(report.pairedFolder).toBeUndefined();
  });
});

describe('includes between mirror trees', () => {
  it('prefers the header of the mirror folder over a shorter path', () => {
    const resolver = new IncludeResolver(['inc/core/util.h', 'inc/net/util.h', 'src/core/engine.cpp', 'src/net/socket.cpp']);
    expect(resolver.resolve('src/core/engine.cpp', 'util.h')).toBe('inc/core/util.h');
    expect(resolver.resolve('src/net/socket.cpp', 'util.h')).toBe('inc/net/util.h');
  });

  it('still takes the shortest path when no folder resembles the including one', () => {
    const resolver = new IncludeResolver(['lib/deep/inside/util.h', 'lib/util.h', 'app/main.cpp']);
    expect(resolver.resolve('app/main.cpp', 'util.h')).toBe('lib/util.h');
  });

  it('draws the includes of a scanned pair between the right classes', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src'));
    const includes = describeEdges(graph.edges.filter((edge) => edge.kind === 'include')).sort();
    // Each `#include "util.h"` leads to the util.h of the mirror folder: Timer for core, Checksum for net.
    expect(includes).toEqual(['include app::Engine -> app::Timer', 'include net::Socket -> net::Checksum']);
  });
});

describe('implementation of a class', () => {
  it('is the first method defined in the source file', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    const implementation = nodeOf(graph, 'app::Engine').implementation!;
    expect(graph.files[implementation.file]).toBe('src/core/engine.cpp');
    // `Engine::Engine() {}` is on line 7 of engine.cpp.
    expect(implementation.line).toBe(7);
  });

  it('is the top of the source file named like the header when it defines no method of the class', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    const implementation = nodeOf(graph, 'app::Timer').implementation!;
    expect(graph.files[implementation.file]).toBe('src/core/util.cpp');
    expect(implementation.line).toBe(1);
  });

  it('is absent for a class that lives in a single file', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'tools'));
    expect(nodeOf(graph, 'CommandLine').implementation).toBeUndefined();
  });

  it('prefers the file named like the header when methods are defined in several files', async () => {
    const graph = await buildGraphFromSources({
      'inc/window.h': 'class Window { void show(); void hide(); };',
      'src/platform.cpp': 'void Window::hide() {}',
      'src/window.cpp': '\n\nvoid Window::show() {}',
    });
    const implementation = nodeOf(graph, 'Window').implementation!;
    expect(graph.files[implementation.file]).toBe('src/window.cpp');
    expect(implementation.line).toBe(3);
  });

  it('gives no implementation to a class that is only forward-declared', async () => {
    const graph = await buildGraphFromSources({ 'inc/canvas.h': 'class Canvas;', 'src/canvas.cpp': 'int unrelated = 0;' });
    expect(nodeOf(graph, 'Canvas').implementation).toBeUndefined();
  });
});

describe('files a class can be opened in', () => {
  it('lists the header, then the source file', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    const targets = openTargetsOf(nodeOf(graph, 'app::Engine'), graph.files);
    expect(targets.map((target) => `${target.fileName}:${target.line}`)).toEqual(['engine.h:8', 'engine.cpp:7']);
    expect(targets[1].description).toBe('Open the implementation of Engine in src/core/engine.cpp');
  });

  it('lists one file for a class without a separate implementation', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'tools'));
    const targets = openTargetsOf(nodeOf(graph, 'CommandLine'), graph.files);
    expect(targets.map((target) => target.fileName)).toEqual(['cli.cpp']);
  });

  it('gives the place of a class and of a member on the asked side', async () => {
    const { graph } = await scanTestFolder(path.join(PAIRED_PROJECT, 'src', 'core'));
    const engine = nodeOf(graph, 'app::Engine');
    const place = (member: Member | undefined, side: CodeSide) => {
      const location = codeLocationOf(engine, member, side);
      return `${graph.files[location.file]}:${location.line}`;
    };
    expect(place(undefined, 'declaration')).toBe('inc/core/engine.h:8');
    expect(place(undefined, 'definition')).toBe('src/core/engine.cpp:7');

    const run = engine.methods.find((method) => method.name === 'run');
    expect(place(run, 'declaration')).toBe('inc/core/engine.h:11');
    expect(place(run, 'definition')).toBe('src/core/engine.cpp:9');

    // An attribute has no definition of its own: both sides open its declaration.
    const timer = engine.attributes.find((attribute) => attribute.name === 'timer');
    expect(place(timer, 'definition')).toBe('inc/core/engine.h:15');
    expect(otherCodeSide('definition')).toBe('declaration');
  });
});
