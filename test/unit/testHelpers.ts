// Shared helpers for unit tests: a parser loaded from node_modules and fixture access.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GraphBuildResult, buildGraph } from '../../src/model/graphBuilder';
import { CppParser, WasmPaths } from '../../src/parser/cppParser';
import { FileSymbols, TypeDeclaration } from '../../src/parser/fileSymbols';
import { parseCppFile } from '../../src/parser/parseCppFile';
import { DiscoveryOptions } from '../../src/scanner/fileDiscovery';
import { createInProcessParseFunction } from '../../src/scanner/inProcessParser';
import { ScanResult, scanFolder } from '../../src/scanner/scanFolder';
import { Edge, Graph } from '../../src/shared/graphModel';

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURES_DIRECTORY = path.join(PROJECT_ROOT, 'test', 'fixtures');

let parserPromise: Promise<CppParser> | undefined;

export function getTestParser(): Promise<CppParser> {
  if (parserPromise === undefined) {
    parserPromise = CppParser.create(TEST_WASM_PATHS);
  }
  return parserPromise;
}

export async function parseSource(sourceText: string, ignoredMacros: string[] = []): Promise<FileSymbols> {
  const parser = await getTestParser();
  return parseCppFile(parser, sourceText, 'test.hpp', ignoredMacros);
}

export async function parseConstructFixture(fileName: string, ignoredMacros: string[] = []): Promise<FileSymbols> {
  const parser = await getTestParser();
  const sourceText = readFileSync(path.join(FIXTURES_DIRECTORY, 'constructs', fileName), 'utf8');
  return parseCppFile(parser, sourceText, fileName, ignoredMacros);
}

export const DEFAULT_DISCOVERY_OPTIONS: DiscoveryOptions = {
  maxDepth: -1,
  extensions: ['.cpp', '.hpp', '.h'],
  exclude: ['**/build/**', '**/out/**', '**/node_modules/**', '**/.git/**', '**/third_party/**', '**/external/**'],
};

const DEFAULT_MAX_FILE_SIZE_BYTES = 2048 * 1024;

interface TestScanOverrides extends Partial<DiscoveryOptions> {
  maxFileSizeBytes?: number;
}

const TEST_WASM_PATHS: WasmPaths = {
  runtime: path.join(PROJECT_ROOT, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
  cppGrammar: path.join(PROJECT_ROOT, 'node_modules', 'tree-sitter-cpp', 'tree-sitter-cpp.wasm'),
};

/** Scans a folder in the current thread, with the default settings unless overridden. */
export function scanTestFolder(folder: string, overrides: TestScanOverrides = {}): Promise<ScanResult> {
  const { maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES, ...discoveryOverrides } = overrides;
  return scanFolder({
    folder,
    discovery: { ...DEFAULT_DISCOVERY_OPTIONS, ...discoveryOverrides },
    parseFiles: createInProcessParseFunction(TEST_WASM_PATHS, { ignoredMacros: [], maxFileSizeBytes }),
  });
}

/** Builds the graph of source texts given by file name. */
export async function buildGraphFromSources(sources: Record<string, string>): Promise<Graph> {
  return (await buildGraphResultFromSources(sources)).graph;
}

export async function buildGraphResultFromSources(sources: Record<string, string>): Promise<GraphBuildResult> {
  const parser = await getTestParser();
  const symbols = Object.entries(sources).map(([file, text]) => parseCppFile(parser, text, file, []));
  return buildGraph('/project', symbols);
}

/** Edges as readable strings such as `inherit Derived -> Base (public)`. */
export function describeEdges(edges: Edge[]): string[] {
  return edges.map((edge) => {
    const details = edge.multiplicity ?? edge.access ?? '';
    return `${edge.kind} ${edge.from} -> ${edge.to}${details === '' ? '' : ` (${details})`}`;
  });
}

/** Where each relation is declared, as `kind from -> to: file:line, file:line`. */
export function describeEdgeLocations(graph: Graph): string[] {
  return graph.edges.map((edge) => {
    const lines = edge.declarations.map((declaration) => `${graph.files[declaration.file]}:${declaration.line}`);
    return `${edge.kind} ${edge.from} -> ${edge.to}: ${lines.join(", ")}`;
  });
}

export function findType(symbols: FileSymbols, qualifiedName: string): TypeDeclaration {
  const found = symbols.types.find((type) => type.qualifiedName === qualifiedName);
  if (found === undefined) {
    const known = symbols.types.map((type) => type.qualifiedName).join(', ');
    throw new Error(`Type ${qualifiedName} not found. Known types: ${known}`);
  }
  return found;
}
