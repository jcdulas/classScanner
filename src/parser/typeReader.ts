// Reads C++ types from syntax nodes, as TypeExpression values and as display text.
//
// In C++, part of a type is attached to the declared name rather than to the
// type itself: in `Foo* items[4];` the syntax tree has a `type` node for `Foo`
// and a `declarator` node chain `array_declarator > pointer_declarator`
// around `items`. Both must be read to know the full type, which is why most
// functions here take a type node and an optional declarator node.

import { TypeExpression } from './fileSymbols';
import { CLASS_SPECIFIER_TYPES, SyntaxNode, normalizeWhitespace, removeTemplateArguments } from './syntaxHelpers';

/** Declarator nodes that add a pointer, reference or array level around a name. */
const POINTER_DECLARATORS = new Set(['pointer_declarator', 'abstract_pointer_declarator']);
const REFERENCE_DECLARATORS = new Set(['reference_declarator', 'abstract_reference_declarator']);
const ARRAY_DECLARATORS = new Set(['array_declarator', 'abstract_array_declarator']);

export function readTypeExpression(typeNode: SyntaxNode, declaratorNode: SyntaxNode | null): TypeExpression {
  const expression = readBaseType(typeNode);
  applyDeclaratorModifiers(expression, declaratorNode);
  return expression;
}

/** Display text of a type, for example `const std::vector<Item>&`. */
export function readTypeText(typeNode: SyntaxNode, declaratorNode: SyntaxNode | null, isConst: boolean): string {
  const prefix = isConst ? 'const ' : '';
  return prefix + normalizeWhitespace(typeNode.text) + readDeclaratorSuffix(declaratorNode);
}

/**
 * The pointer, reference and array markers of a declarator chain, for example `*` or `&` or `[4]`.
 * The walk stops at the declared name or at a function declarator.
 */
export function readDeclaratorSuffix(declaratorNode: SyntaxNode | null): string {
  let suffix = '';
  let current = declaratorNode;
  while (current !== null && current.type !== 'function_declarator') {
    if (POINTER_DECLARATORS.has(current.type)) {
      suffix += '*';
    } else if (REFERENCE_DECLARATORS.has(current.type)) {
      suffix += current.text.trimStart().startsWith('&&') ? '&&' : '&';
    } else if (ARRAY_DECLARATORS.has(current.type)) {
      const size = current.childForFieldName('size');
      suffix += size === null ? '[]' : `[${normalizeWhitespace(size.text)}]`;
    }
    current = innerDeclarator(current);
  }
  return suffix;
}

/**
 * The declarator nested inside a declarator. Most declarators store it in the `declarator`
 * field; reference declarators store it as their last named child.
 */
export function innerDeclarator(declaratorNode: SyntaxNode): SyntaxNode | null {
  const fieldChild = declaratorNode.childForFieldName('declarator');
  if (fieldChild !== null) {
    return fieldChild;
  }
  if (REFERENCE_DECLARATORS.has(declaratorNode.type)) {
    return declaratorNode.lastNamedChild;
  }
  return null;
}

/** The declared name at the bottom of a declarator chain: `count`, `~Shape`, `operator=`, `Engine::run`. */
export function readDeclaratorName(declarator: SyntaxNode | null): string {
  let current = declarator;
  while (current !== null) {
    switch (current.type) {
      case 'identifier':
      case 'field_identifier':
      case 'type_identifier':
      case 'destructor_name':
      case 'operator_name':
      case 'qualified_identifier':
      case 'template_function':
      case 'operator_cast':
        return normalizeWhitespace(current.text);
    }
    const inner: SyntaxNode | null = innerDeclarator(current) ?? current.lastNamedChild;
    if (inner === null || inner.id === current.id) {
      return normalizeWhitespace(current.text);
    }
    current = inner;
  }
  return '';
}

/** Every type name in an expression, including the ones in template arguments. */
export function collectTypeNames(expression: TypeExpression): string[] {
  const names: string[] = [];
  const pending: TypeExpression[] = [expression];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.name !== '') {
      names.push(current.name);
    }
    pending.push(...current.templateArguments);
  }
  return names;
}

function readBaseType(typeNode: SyntaxNode): TypeExpression {
  switch (typeNode.type) {
    case 'template_type':
      return {
        name: readQualifiedName(typeNode),
        templateArguments: readTemplateArguments(typeNode.childForFieldName('arguments')),
        indirection: 'value',
        isArray: false,
      };
    case 'qualified_identifier':
      return {
        name: readQualifiedName(typeNode),
        templateArguments: readTemplateArguments(findLastTemplateArgumentList(typeNode)),
        indirection: 'value',
        isArray: false,
      };
    case 'dependent_type': {
      // `typename T::value_type`: read the type after `typename`.
      const inner = typeNode.lastNamedChild;
      return inner === null ? simpleType('') : readBaseType(inner);
    }
    case 'placeholder_type_specifier':
    case 'decltype':
      return simpleType('');
    default:
      if (CLASS_SPECIFIER_TYPES.has(typeNode.type) || typeNode.type === 'enum_specifier') {
        // An elaborated type such as `struct Foo* p;`, or an inline definition such as `struct { int a; } p;`.
        const nameNode = typeNode.childForFieldName('name');
        return nameNode === null ? simpleType('') : readBaseType(nameNode);
      }
      return simpleType(normalizeWhitespace(typeNode.text));
  }
}

function simpleType(name: string): TypeExpression {
  return { name, templateArguments: [], indirection: 'value', isArray: false };
}

/** `std::vector<int>` gives `std::vector`; `Outer<T>::Inner` gives `Outer::Inner`. */
export function readQualifiedName(node: SyntaxNode): string {
  return removeTemplateArguments(normalizeWhitespace(node.text)).replace(/^::/, '');
}

/** In `a::b::vector<int>`, the argument list belongs to the last part of the name. */
function findLastTemplateArgumentList(qualifiedNode: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = qualifiedNode;
  while (current !== null && current.type === 'qualified_identifier') {
    current = current.childForFieldName('name');
  }
  if (current !== null && current.type === 'template_type') {
    return current.childForFieldName('arguments');
  }
  return null;
}

function readTemplateArguments(argumentList: SyntaxNode | null): TypeExpression[] {
  if (argumentList === null) {
    return [];
  }
  const argumentsFound: TypeExpression[] = [];
  for (const argument of argumentList.namedChildren) {
    // Type arguments are `type_descriptor` nodes; values such as `3` in `std::array<int, 3>` are skipped.
    if (argument !== null && argument.type === 'type_descriptor') {
      const typeNode = argument.childForFieldName('type');
      if (typeNode !== null) {
        argumentsFound.push(readTypeExpression(typeNode, argument.childForFieldName('declarator')));
      }
    }
  }
  return argumentsFound;
}

function applyDeclaratorModifiers(expression: TypeExpression, declaratorNode: SyntaxNode | null): void {
  let current = declaratorNode;
  while (current !== null && current.type !== 'function_declarator') {
    if (POINTER_DECLARATORS.has(current.type)) {
      expression.indirection = 'pointer';
    } else if (REFERENCE_DECLARATORS.has(current.type) && expression.indirection === 'value') {
      expression.indirection = 'reference';
    } else if (ARRAY_DECLARATORS.has(current.type)) {
      expression.isArray = true;
    }
    current = innerDeclarator(current);
  }
}
