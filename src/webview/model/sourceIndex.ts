// Maps source lines to their owning class for editor navigation and Git changes.

import { Graph } from '../../shared/graphModel';
import { LineRange } from '../../shared/messages';

interface ClassRange {
  classId: string;
  firstLine: number;
  lastLine: number;
  children: ClassRange[];
}

export class SourceIndex {
  private readonly rangesByFile = new Map<number, ClassRange[]>();
  private readonly methodsByFile = new Map<number, { line: number; classId: string; method: string }[]>();

  constructor(graph: Graph) {
    for (const node of graph.nodes) {
      for (const { file, firstLine, lastLine } of node.sourceRanges ?? []) {
        const ranges = this.rangesByFile.get(file) ?? [];
        ranges.push({ classId: node.id, firstLine, lastLine, children: [] });
        this.rangesByFile.set(file, ranges);
      }
      for (const method of node.methods) {
        for (const place of method.definition === undefined ? [method] : [method, method.definition]) {
          const methods = this.methodsByFile.get(place.file) ?? [];
          methods.push({ line: place.line, classId: node.id, method: method.name });
          this.methodsByFile.set(place.file, methods);
        }
      }
    }
    for (const ranges of this.rangesByFile.values()) {
      // Parents precede nested classes, even when both are written on one line.
      ranges.sort((a, b) => a.firstLine - b.firstLine || b.lastLine - a.lastLine || a.classId.length - b.classId.length);
      const enclosing: ClassRange[] = [];
      for (const range of ranges) {
        while (enclosing.length > 0) {
          const parent = enclosing[enclosing.length - 1];
          if (range.lastLine <= parent.lastLine && range.classId.startsWith(parent.classId + '::')) {
            parent.children.push(range);
            break;
          }
          enclosing.pop();
        }
        enclosing.push(range);
      }
    }
  }

  classAt(file: number, line: number): string | undefined {
    return this.classesInRange(file, { firstLine: line, lastLine: line })[0];
  }

  /** The includes above the first class can still serve as a shortcut to that class. */
  classToShowAt(file: number, line: number): string | undefined {
    const first = this.rangesByFile.get(file)?.[0];
    return first !== undefined && line < first.firstLine ? first.classId : this.classAt(file, line);
  }

  classesInRange(file: number, change: LineRange): string[] {
    const ids = new Set<string>();
    for (const range of this.rangesByFile.get(file) ?? []) {
      if (range.firstLine > change.lastLine) break;
      if (ownsChangedLines(range, change)) ids.add(range.classId);
    }
    return Array.from(ids);
  }

  /** Identifies a method from the name and source range reported by the C++ extension. */
  methodIn(file: number, firstLine: number, lastLine: number, name: string): { classId: string; method: string } | undefined {
    const match = this.methodsByFile.get(file)?.find((entry) => entry.line >= firstLine && entry.line <= lastLine && entry.method === name);
    return match === undefined ? undefined : { classId: match.classId, method: match.method };
  }
}

/** Nested classes own their own lines. Only a deletion strictly inside a definition belongs to it. */
function ownsChangedLines(range: ClassRange, change: LineRange): boolean {
  if (change.deletionOnly) {
    return range.firstLine <= change.firstLine && range.lastLine >= change.lastLine
      && !range.children.some((child) => child.firstLine <= change.firstLine && child.lastLine >= change.lastLine);
  }
  let first = Math.max(range.firstLine, change.firstLine);
  const last = Math.min(range.lastLine, change.lastLine);
  for (const child of range.children) {
    if (child.firstLine > first) break;
    first = Math.max(first, child.lastLine + 1);
  }
  return first <= last;
}
