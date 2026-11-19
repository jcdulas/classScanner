// The class graph produced by a scan (spec §5).
//
// This module is shared by the extension host, which builds the graph, and by
// the webview, which displays it. It only contains plain, serializable data
// types so that a graph can be sent to the webview with postMessage.

export type RelationKind = 'inherit' | 'compose' | 'aggregate' | 'depend' | 'include' | 'friend' | 'nest';

export const ALL_RELATION_KINDS: RelationKind[] = [
  'inherit',
  'compose',
  'aggregate',
  'depend',
  'include',
  'friend',
  'nest',
];

export type EntityKind = 'class' | 'struct' | 'union' | 'enum';

export type Visibility = 'public' | 'protected' | 'private';

/** Bit flags stored in Member.flags. */
export const MemberFlags = {
  Static: 1,
  Virtual: 2,
  PureVirtual: 4,
  Const: 8,
} as const;

export interface Graph {
  /** Absolute path of the scanned folder. */
  root: string;
  nodes: ClassNode[];
  edges: Edge[];
  /** Paths relative to `root`, with forward slashes. Nodes and members reference them by index. */
  files: string[];
}

export interface ClassNode {
  /** Qualified name, for example `app::core::Engine`. Unique in a graph. */
  id: string;
  /** Short name, for example `Engine`. */
  name: string;
  kind: EntityKind;
  /** Enclosing namespace, for example `app::core`, or an empty string for the global namespace. */
  namespace: string;
  /** Index in Graph.files of the file that contains the declaration. */
  file: number;
  /** 1-based line of the declaration. */
  line: number;
  templateParams?: string[];
  /** Names of the template specializations, for example `Buffer<int>`. */
  specializations?: string[];
  isAbstract: boolean;
  /** True when the class is only forward-declared in the scanned files. */
  isExternal: boolean;
  attributes: Member[];
  methods: Member[];
  enumValues?: string[];
}

export interface Member {
  name: string;
  /** For an attribute: its type. For a method: its parameters, qualifiers and return type. */
  signature: string;
  visibility: Visibility;
  /** Combination of MemberFlags. */
  flags: number;
  file: number;
  line: number;
}

export interface Edge {
  from: string;
  to: string;
  kind: RelationKind;
  /** Inheritance only. */
  access?: Visibility;
  /** Composition and aggregation only. */
  multiplicity?: '1' | '*';
}

/** Statistics shown to the user after a scan. */
export interface ScanReport {
  folder: string;
  depth: number;
  durationMs: number;
  scannedFileCount: number;
  skippedLargeFiles: string[];
  /** Files in which tree-sitter found syntax it could not parse. */
  filesWithParseErrors: string[];
  parseErrorCount: number;
  unresolvedTypeReferenceCount: number;
  /** The most frequent unresolved type names, most frequent first. */
  topUnresolvedTypeNames: { name: string; count: number }[];
  nodeCount: number;
  edgeCounts: Record<RelationKind, number>;
}

export function hasFlag(member: Member, flag: number): boolean {
  return (member.flags & flag) !== 0;
}

export function isTemplate(node: ClassNode): boolean {
  return node.templateParams !== undefined && node.templateParams.length > 0;
}
