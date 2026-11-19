// Writes a set of classes as compact text that a language model (LLM) can read.
//
// The format looks like C++ declarations, which language models know well, but
// keeps only what describes the design: classes grouped by namespace, with
// their bases, members and source location, then the relations between them
// as one short line each. A legend at the top explains the notation, so the
// text can be pasted into a prompt as it is.
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

const VISIBILITY_SIGNS: Record<Visibility, string> = { public: '+', protected: '#', private: '-' };

const RELATION_ARROWS: Record<Exclude<RelationKind, 'inherit'>, string> = {
  compose: '*--',
  aggregate: 'o--',
  depend: '..>',
  include: '..include..>',
  friend: '..friend..>',
  nest: '+--',
};

const LEGEND = [
  '# Members: + public, # protected, - private; "static", "virtual" and "= 0" (pure virtual) as in C++.',
  '# Base classes follow the class name. Relations: A *-- B (A owns B), A o-- B (A holds B by pointer or',
  '# shared reference), A ..> B (A uses B), A ..include..> B (the file of A includes the file of B),',
  '# A ..friend..> B (A declares B as friend), A +-- B (B is nested in A). [*] marks a collection.',
];

export interface SchemaOptions {
  /** Name of the scanned folder, written in the header. */
  projectName: string;
  /** Relation kinds to list. Inheritance is always written as the bases of each class. */
  relationKinds: Set<RelationKind>;
}

export function buildLlmSchema(graph: Graph, nodeIds: string[], options: SchemaOptions): string {
  const selected = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => selected.has(node.id)).sort((first, second) => first.id.localeCompare(second.id));
  if (nodes.length === 0) {
    throw new Error('No class to export.');
  }
  const lines: string[] = [`# C++ class schema of ${options.projectName} (${nodes.length} classes), exported by classScanner.`, ...LEGEND];

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
      lines.push(...classLines(node, basesByClass.get(node.id) ?? [], graph.files));
    }
  }
  lines.push(...relationLines(graph.edges, selected, options.relationKinds));
  return lines.join('\n') + '\n';
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

function classLines(node: ClassNode, bases: Edge[], files: string[]): string[] {
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
  const location = `${files[node.file] ?? '?'}:${node.line}`;
  header += node.isExternal ? `  [forward-declared only, ${location}]` : `  [${location}]`;

  const lines = [`  ${header}`];
  if (node.enumValues !== undefined && node.enumValues.length > 0) {
    lines.push(`    values: ${node.enumValues.join(', ')}`);
  }
  for (const attribute of node.attributes) {
    lines.push(`    ${memberLine(attribute, `${attribute.name}: ${attribute.signature}`)}`);
  }
  for (const method of node.methods) {
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
