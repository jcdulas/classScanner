// Collects the type names used in the body of a method (spec §3, dependency relation).
//
// Inside a function body, tree-sitter cannot always tell a type from a
// variable. Two kinds of nodes are collected:
//   - `type_identifier`: a name used where a type is expected, as in
//     `Helper h;`, `new Factory()` or `static_cast<Derived*>(p)`;
//   - the scope of a `qualified_identifier`, as `Registry` in
//     `Registry::instance()`, which is usually a class or a namespace.
// Names that are not project classes are dropped later, by the name resolver.

import { SyntaxNode, isSameNode, normalizeWhitespace, removeTemplateArguments } from './syntaxHelpers';

export function collectBodyTypeNames(bodyNodes: SyntaxNode[]): string[] {
  const names = new Set<string>();
  for (const bodyNode of bodyNodes) {
    // descendantsOfType runs inside tree-sitter, which is much faster than walking the tree in JavaScript.
    for (const node of bodyNode.descendantsOfType(['type_identifier', 'qualified_identifier'])) {
      if (node === null) {
        continue;
      }
      const name = node.type === 'type_identifier' ? fullTypeName(node) : expressionScopeName(node);
      if (name !== '') {
        names.add(name);
      }
    }
  }
  return Array.from(names);
}

/**
 * For `vector` in `std::vector<int>`, returns `std::vector`: climbs to the outermost
 * node of the qualified name, then removes the template arguments.
 */
function fullTypeName(typeIdentifier: SyntaxNode): string {
  let top = typeIdentifier;
  while (top.parent !== null && isNamePartOf(top, top.parent)) {
    top = top.parent;
  }
  return removeTemplateArguments(normalizeWhitespace(top.text)).replace(/^::/, '');
}

function isNamePartOf(child: SyntaxNode, parent: SyntaxNode): boolean {
  const isQualifiedOrTemplate = parent.type === 'qualified_identifier' || parent.type === 'template_type';
  return isQualifiedOrTemplate && isSameNode(parent.childForFieldName('name'), child);
}

/**
 * For `Registry::instance` in an expression, returns `Registry`. Qualified names that end with
 * a type are skipped: their `type_identifier` is already collected by `fullTypeName`.
 */
function expressionScopeName(qualifiedIdentifier: SyntaxNode): string {
  const parent = qualifiedIdentifier.parent;
  if (parent !== null && parent.type === 'qualified_identifier') {
    // Only the outermost node of a qualified name is processed.
    return '';
  }
  let last: SyntaxNode | null = qualifiedIdentifier;
  while (last !== null && last.type === 'qualified_identifier') {
    last = last.childForFieldName('name');
  }
  if (last === null || last.type === 'type_identifier' || last.type === 'template_type') {
    return '';
  }
  const fullName = removeTemplateArguments(normalizeWhitespace(qualifiedIdentifier.text)).replace(/^::/, '');
  const scopeEnd = fullName.lastIndexOf('::');
  return scopeEnd <= 0 ? '' : fullName.slice(0, scopeEnd);
}
