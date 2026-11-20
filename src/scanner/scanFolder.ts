// Runs a complete scan of a folder: file discovery, parsing, graph building (spec §2).
//
// When the folder is one half of a pair of header and source folders
// (pairedFolder.ts), the other half is scanned with it, and the paths of the
// files are relative to the folder that contains both.
//
// This module does not depend on the VS Code API, so it can also run in unit
// tests and in the benchmark script. The parsing step is passed in as a
// function: the extension uses worker threads (parserPool.ts), the tests
// parse in the current thread.

import path from 'node:path';
import { buildGraph } from '../model/graphBuilder';
import { FileSymbols } from '../parser/fileSymbols';
import { ALL_RELATION_KINDS, Graph, RelationKind, ScanReport } from '../shared/graphModel';
import { DiscoveredFile, DiscoveryOptions, discoverFiles } from './fileDiscovery';
import { findPairedFolder } from './pairedFolder';

export interface ParsedFiles {
  fileSymbols: FileSymbols[];
  /** Relative paths of the files that were not parsed because they are above the size limit. */
  skippedLargeFiles: string[];
}

/** Reads and parses files. `onProgress` gets the number of files done so far, skipped ones included. */
export type ParseFilesFunction = (
  files: DiscoveredFile[],
  onProgress: (parsedFileCount: number) => void,
  isCancelled: () => boolean,
) => Promise<ParsedFiles>;

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

  const paired = await findPairedFolder(request.folder);
  const root = paired?.commonParent ?? request.folder;
  const scannedFolders = paired === undefined ? [request.folder] : [request.folder, paired.folder];
  const files = await discoverFilesOfFolders(root, scannedFolders, request.discovery);
  request.onDiscovered?.(files.length);

  const { fileSymbols, skippedLargeFiles } = await request.parseFiles(
    files,
    (parsedFileCount) => request.onProgress?.(parsedFileCount, files.length),
    isCancelled,
  );
  const { graph, unresolvedTypeNames } = buildGraph(root, fileSymbols);

  const report: ScanReport = {
    folder: request.folder,
    pairedFolder: paired?.folder,
    depth: request.discovery.maxDepth,
    durationMs: Date.now() - startTime,
    scannedFileCount: fileSymbols.length,
    skippedLargeFiles: skippedLargeFiles.sort(),
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

/**
 * Lists the files of every folder, with paths relative to `root` instead of to their own folder.
 * The folders are listed at the same time: on a slow disk, their waits overlap.
 */
async function discoverFilesOfFolders(root: string, folders: string[], options: DiscoveryOptions): Promise<DiscoveredFile[]> {
  const filesOfFolders = await Promise.all(
    folders.map(async (folder) => {
      const folderFromRoot = path.relative(root, folder).split(path.sep).join('/');
      const fromRoot = (relativePath: string) => (folderFromRoot === '' ? relativePath : `${folderFromRoot}/${relativePath}`);
      const files = await discoverFiles(folder, options);
      return files.map((file) => ({ absolutePath: file.absolutePath, relativePath: fromRoot(file.relativePath) }));
    }),
  );
  return filesOfFolders.flat().sort((first, second) => first.relativePath.localeCompare(second.relativePath));
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
