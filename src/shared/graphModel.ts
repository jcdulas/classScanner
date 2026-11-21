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
  /**
   * Absolute path of the folder that the paths of `files` are relative to: the scanned folder,
   * or the folder that contains the scanned folder and its paired folder (spec §2.2).
   */
  root: string;
  nodes: ClassNode[];
  edges: Edge[];
  /** Calls of a method of another class, found in the code of the methods (spec §3.1). */
  calls: MethodCall[];
  /** Paths relative to `root`, with forward slashes. Nodes and members reference them by index. */
  files: string[];
}

/** A place in a file of the graph. */
export interface SourceLocation {
  /** Index in Graph.files. */
  file: number;
  /** 1-based line. */
  line: number;
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
  /** Indexes in Graph.files of the other files that define methods of the class, usually .cpp files. */
  definitionFiles?: number[];
  /**
   * Where the class is implemented, when that is another file than its declaration: the first
   * method defined outside the class, usually in a .cpp file, otherwise the top of the source
   * file named like its header. The diagram offers to open either file.
   */
  implementation?: SourceLocation;
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
  /** Where the member is declared, in the body of its class: index in Graph.files and 1-based line. */
  file: number;
  line: number;
  /** For a method defined outside its class, usually in a .cpp file: where its code is. */
  definition?: SourceLocation;
}

/**
 * The two places where the code of a class or of a method can be opened (spec §4.6): its
 * declaration, usually in a header, and its definition, usually in a .cpp file.
 */
export type CodeSide = 'declaration' | 'definition';

/**
 * A line of the sources that creates a relation: the base class in the list of bases, the
 * attribute, the method or the line of code that uses the other class, the `#include`, the
 * `friend` declaration, the nested class.
 */
export interface RelationDeclaration {
  /** Index in Graph.files. */
  file: number;
  /** 1-based line. */
  line: number;
  /** Name of the attribute or of the method of the `from` class that creates the relation, when there is one. */
  member?: string;
}

export interface Edge {
  from: string;
  to: string;
  kind: RelationKind;
  /**
   * Every line that declares the relation, in the order they were found: declarations in class
   * bodies come before code in .cpp files. Never empty. The diagram opens the first one when
   * the arrow is clicked, and lists them all in the interface of a selection (spec §4.6).
   */
  declarations: RelationDeclaration[];
  /** Inheritance only. */
  access?: Visibility;
  /** Composition and aggregation only. */
  multiplicity?: '1' | '*';
}

/**
 * A call of a method of another class, found in the code of a method (spec §3.1). Calls are
 * found without a compiler, from the names and the declared types of the code: some are
 * missed, and a few may be wrong.
 */
export interface MethodCall {
  /** The class whose method makes the call. */
  from: string;
  /** Name of the method that makes the call. */
  fromMethod: string;
  /** The class of the object the method is called on. */
  to: string;
  /** Name of the called method; it is declared by `to` or by one of its base classes. */
  method: string;
  /** Where the call is: index in Graph.files and 1-based line. */
  file: number;
  line: number;
}

/** Statistics shown to the user after a scan. */
export interface ScanReport {
  /** Absolute path of the folder the user asked to scan. */
  folder: string;
  /** Absolute path of the header or source folder scanned with it (spec §2.2), when there is one. */
  pairedFolder?: string;
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
  methodCallCount: number;
}

export function hasFlag(member: Member, flag: number): boolean {
  return (member.flags & flag) !== 0;
}

/** True for a C++ header, by its extension: `inc/core/engine.h`. */
export function isHeaderFile(file: string): boolean {
  return /\.(h|hh|hpp|hxx)$/i.test(file);
}

export function isTemplate(node: ClassNode): boolean {
  return node.templateParams !== undefined && node.templateParams.length > 0;
}
