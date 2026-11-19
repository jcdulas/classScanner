// Runs a complete scan of a folder: file discovery, parsing, graph building (spec §2).
//
// This module does not depend on the VS Code API, so it can also run in unit
// tests and in the benchmark script. The parsing step is passed in as a
// function: the extension uses worker threads (parserPool.ts), the tests
// parse in the current thread.

import { buildGraph } from '../model/graphBuilder';
import { FileSymbols } from '../parser/fileSymbols';
import { ALL_RELATION_KINDS, Graph, RelationKind, ScanReport } from '../shared/graphModel';
import { DiscoveredFile, DiscoveryOptions, discoverFiles } from './fileDiscovery';

export type ParseFilesFunction = (
  files: DiscoveredFile[],
  onProgress: (parsedFileCount: number) => void,
  isCancelled: () => boolean,
) => Promise<FileSymbols[]>;

export interface ScanRequest {
  folder: string;
  discovery: DiscoveryOptions;
  parseFiles: ParseFilesFunction;
  onDiscovered?: (fileCount: number) => void;
  onProgress?: (parsedFileCount: number, totalFileCount: number) => void;
  isCancelled?: () => boolean;
}

export interface ScanResult {
  graph: Graph;
  report: ScanReport;
}

const TOP_UNRESOLVED_NAME_COUNT = 20;

export async function scanFolder(request: ScanRequest): Promise<ScanResult> {
  const startTime = Date.now();
  const isCancelled = request.isCancelled ?? (() => false);

  const discovery = await discoverFiles(request.folder, request.discovery);
  request.onDiscovered?.(discovery.files.length);

  const totalFileCount = discovery.files.length;
  const fileSymbols = await request.parseFiles(
    discovery.files,
    (parsedFileCount) => request.onProgress?.(parsedFileCount, totalFileCount),
    isCancelled,
  );
  const { graph, unresolvedTypeNames } = buildGraph(request.folder, fileSymbols);

  const report: ScanReport = {
    folder: request.folder,
    depth: request.discovery.maxDepth,
    durationMs: Date.now() - startTime,
    scannedFileCount: totalFileCount,
    skippedLargeFiles: discovery.skippedLargeFiles,
    filesWithParseErrors: fileSymbols.filter((symbols) => symbols.parseErrorCount > 0).map((symbols) => symbols.file).sort(),
    parseErrorCount: sum(fileSymbols.map((symbols) => symbols.parseErrorCount)),
    unresolvedTypeReferenceCount: sum(Array.from(unresolvedTypeNames.values())),
    topUnresolvedTypeNames: Array.from(unresolvedTypeNames, ([name, count]) => ({ name, count }))
      .sort((first, second) => second.count - first.count || first.name.localeCompare(second.name))
      .slice(0, TOP_UNRESOLVED_NAME_COUNT),
    nodeCount: graph.nodes.length,
    edgeCounts: countEdgesByKind(graph),
  };
  return { graph, report };
}

function countEdgesByKind(graph: Graph): Record<RelationKind, number> {
  const counts = Object.fromEntries(ALL_RELATION_KINDS.map((kind) => [kind, 0])) as Record<RelationKind, number>;
  for (const edge of graph.edges) {
    counts[edge.kind]++;
  }
  return counts;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
