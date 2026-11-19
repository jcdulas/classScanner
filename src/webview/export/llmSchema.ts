// Writes a set of classes as compact text that a language model (LLM) can read.
//
// The format looks like C++ declarations, which language models know well, but
// keeps only what describes the design: classes grouped by namespace, with
// their bases, members and source location, then the relations between them
// as one short line each. A legend at the top explains the notation, so the
// text can be pasted into a prompt as it is.
//
// The size of a prompt matters, so the schema can be made lighter: without
// private members, with public members only, without any member, and without
// the file locations. The header then says what was left out, so that the
// reader does not take the schema for the complete class.
//
// Example:
//   namespace geo
//     abstract class Shape  [include/geometry/shape.h:15]
//       # origin: Point
//       + virtual area() const: double = 0
//     class Circle : public Shape  [include/geometry/shape.h:26]
//       - radius: double
//   relations
//     geo::Polygon *-- geo::Point [*]

import { ClassNode, Edge, Graph, Member, MemberFlags, RelationKind, Visibility } from '../../shared/graphModel';
import { SchemaDetail, SchemaMemberLevel } from '../../shared/savedState';

const VISIBILITY_SIGNS: Record<Visibility, string> = { public: '+', protected: '#', private: '-' };

const SHOWN_VISIBILITIES: Record<SchemaMemberLevel, Visibility[]> = {
  all: ['public', 'protected', 'private'],
  nonPrivate: ['public', 'protected'],
  public: ['public'],
  none: [],
};

/** What the header says about the members that are left out. */
const OMISSION_NOTES: Record<SchemaMemberLevel, string | undefined> = {
  all: undefined,
  nonPrivate: '# Private members are left out.',
  public: '# Only public members are listed.',
  none: '# Members are left out: only the classes and their relations are listed.',
};

const RELATION_ARROWS: Record<Exclude<RelationKind, 'inherit'>, string> = {
  compose: '*--',
  aggregate: 'o--',
  depend: '..>',
  include: '..include..>',
  friend: '..friend..>',
  nest: '+--',
};

const MEMBER_LEGEND = '# Members: + public, # protected, - private; "static", "virtual" and "= 0" (pure virtual) as in C++.';

const RELATION_LEGEND = [
  '# Base classes follow the class name. Relations: A *-- B (A owns B), A o-- B (A holds B by pointer or',
  '# shared reference), A ..> B (A uses B), A ..include..> B (the file of A includes the file of B),',
  '# A ..friend..> B (A declares B as friend), A +-- B (B is nested in A). [*] marks a collection.',
];

export interface SchemaOptions {
  /** Name of the scanned folder, written in the header. */
  projectName: string;
  /** Relation kinds to list. Inheritance is always written as the bases of each class. */
  relationKinds: Set<RelationKind>;
  /** Which members to list, and whether to write the file and line of each class. */
  detail: SchemaDetail;
}

export function buildLlmSchema(graph: Graph, nodeIds: string[], options: SchemaOptions): string {
  const selected = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => selected.has(node.id)).sort((first, second) => first.id.localeCompare(second.id));
  if (nodes.length === 0) {
    throw new Error('No class to export.');
  }
  const lines: string[] = [
    `# C++ class schema of ${options.projectName} (${nodes.length} classes), exported by classScanner.`,
    ...legendLines(options.detail.members),
  ];

  const basesByClass = new Map<string, Edge[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'inherit' && selected.has(edge.from)) {
      const bases = basesByClass.get(edge.from) ?? [];
      bases.push(edge);
      basesByClass.set(edge.from, bases);
    }
  }

  for (const [namespace, members] of groupByNamespace(nodes)) {
    lines.push('', namespace === '' ? '(global namespace)' : `namespace ${namespace}`);
    for (const node of members) {
      lines.push(...classLines(node, basesByClass.get(node.id) ?? [], graph.files, options.detail));
    }
  }
  lines.push(...relationLines(graph.edges, selected, options.relationKinds));
  return lines.join('\n') + '\n';
}

/**
 * A rough number of tokens of a text for a language model: about one token for four
 * characters of code. It is an estimate to compare options, not an exact count.
 */
export function estimateTokenCount(text: string): number {
  return Math.round(text.length / 4);
}

function legendLines(memberLevel: SchemaMemberLevel): string[] {
  const lines: string[] = [];
  if (memberLevel !== 'none') {
    lines.push(MEMBER_LEGEND);
  }
  const omissionNote = OMISSION_NOTES[memberLevel];
  if (omissionNote !== undefined) {
    lines.push(omissionNote);
  }
  lines.push(...RELATION_LEGEND);
  return lines;
}

function groupByNamespace(nodes: ClassNode[]): Map<string, ClassNode[]> {
  const groups = new Map<string, ClassNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.namespace) ?? [];
    list.push(node);
    groups.set(node.namespace, list);
  }
  return new Map(Array.from(groups).sort(([first], [second]) => first.localeCompare(second)));
}

function classLines(node: ClassNode, bases: Edge[], files: string[], detail: SchemaDetail): string[] {
  const words: string[] = [];
  if (node.templateParams !== undefined && node.templateParams.length > 0) {
    words.push(`template <${node.templateParams.join(', ')}>`);
  }
  if (node.isAbstract) {
    words.push('abstract');
  }
  words.push(node.kind, nameWithinNamespace(node));
  let header = words.join(' ');
  if (bases.length > 0) {
    header += ' : ' + bases.map((base) => `${base.access ?? 'public'} ${base.to}`).join(', ');
  }
  // In brackets after the class: what is known about where it comes from.
  const notes: string[] = [];
  if (node.isExternal) {
    notes.push('forward-declared only');
  }
  if (detail.includeLocations) {
    notes.push(`${files[node.file] ?? '?'}:${node.line}`);
  }
  if (notes.length > 0) {
    header += `  [${notes.join(', ')}]`;
  }

  const lines = [`  ${header}`];
  if (detail.members === 'none') {
    return lines;
  }
  const shownVisibilities = SHOWN_VISIBILITIES[detail.members];
  const isShown = (member: Member) => shownVisibilities.includes(member.visibility);
  if (node.enumValues !== undefined && node.enumValues.length > 0) {
    lines.push(`    values: ${node.enumValues.join(', ')}`);
  }
  for (const attribute of node.attributes.filter(isShown)) {
    lines.push(`    ${memberLine(attribute, `${attribute.name}: ${attribute.signature}`)}`);
  }
  for (const method of node.methods.filter(isShown)) {
    const pure = (method.flags & MemberFlags.PureVirtual) !== 0 ? ' = 0' : '';
    lines.push(`    ${memberLine(method, `${method.name}${method.signature}${pure}`)}`);
  }
  if (node.specializations !== undefined && node.specializations.length > 0) {
    lines.push(`    specializations: ${node.specializations.join(', ')}`);
  }
  return lines;
}

function memberLine(member: Member, text: string): string {
  const prefixes: string[] = [VISIBILITY_SIGNS[member.visibility]];
  if ((member.flags & MemberFlags.Static) !== 0) prefixes.push('static');
  if ((member.flags & MemberFlags.Virtual) !== 0) prefixes.push('virtual');
  return `${prefixes.join(' ')} ${text}`;
}

/** `Outer::Inner` for a nested class, the short name otherwise. */
function nameWithinNamespace(node: ClassNode): string {
  return node.namespace === '' ? node.id : node.id.slice(node.namespace.length + 2);
}

function relationLines(edges: Edge[], selected: Set<string>, relationKinds: Set<RelationKind>): string[] {
  const inside: string[] = [];
  const outside: string[] = [];
  for (const edge of edges) {
    if (edge.kind === 'inherit' || !relationKinds.has(edge.kind) || !selected.has(edge.from)) {
      continue;
    }
    const multiplicity = edge.multiplicity === '*' ? ' [*]' : '';
    const line = `  ${edge.from} ${RELATION_ARROWS[edge.kind]} ${edge.to}${multiplicity}`;
    (selected.has(edge.to) ? inside : outside).push(line);
  }
  const lines: string[] = [];
  if (inside.length > 0) {
    lines.push('', 'relations', ...inside.sort());
  }
  if (outside.length > 0) {
    lines.push('', 'relations to classes outside this schema', ...outside.sort());
  }
  return lines;
}
