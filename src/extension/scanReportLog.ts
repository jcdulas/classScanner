// Writes the scan report to the "classScanner" output channel.

import * as vscode from 'vscode';
import { ALL_RELATION_KINDS, ScanReport } from '../shared/graphModel';

const MAX_LISTED_FILES = 20;

export function logScanReport(output: vscode.OutputChannel, report: ScanReport): void {
  const depthText = report.depth < 0 ? 'unlimited' : String(report.depth);
  output.appendLine('');
  output.appendLine(`=== Scan of ${report.folder} (depth: ${depthText}) ===`);
  output.appendLine(`Duration: ${(report.durationMs / 1000).toFixed(1)} s`);
  output.appendLine(`Files scanned: ${report.scannedFileCount}`);
  output.appendLine(`Classes: ${report.nodeCount}`);
  const edgeSummary = ALL_RELATION_KINDS.map((kind) => `${kind} ${report.edgeCounts[kind]}`).join(', ');
  output.appendLine(`Relations: ${edgeSummary}`);

  if (report.skippedLargeFiles.length > 0) {
    output.appendLine(`Skipped large files (${report.skippedLargeFiles.length}):`);
    logList(output, report.skippedLargeFiles);
  }
  if (report.parseErrorCount > 0) {
    output.appendLine(
      `Syntax errors: ${report.parseErrorCount} in ${report.filesWithParseErrors.length} files. ` +
        'Declarations around them may be missing; macros are a frequent cause (setting classScanner.ignoredMacros).',
    );
    logList(output, report.filesWithParseErrors);
  }
  if (report.unresolvedTypeReferenceCount > 0) {
    output.appendLine(`Unresolved type references: ${report.unresolvedTypeReferenceCount}. Most frequent names:`);
    for (const entry of report.topUnresolvedTypeNames) {
      output.appendLine(`  ${entry.name} (${entry.count})`);
    }
  }
}

function logList(output: vscode.OutputChannel, items: string[]): void {
  for (const item of items.slice(0, MAX_LISTED_FILES)) {
    output.appendLine(`  ${item}`);
  }
  if (items.length > MAX_LISTED_FILES) {
    output.appendLine(`  ... and ${items.length - MAX_LISTED_FILES} more`);
  }
}
