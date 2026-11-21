// Reads the expression that a method is called on, and keeps of it what tells
// its type (spec §3.1): `factory().create()` is called on the result of
// `factory()`, and `job->run()`, after `auto* job = pool.nextJob();`, on the
// result of `nextJob()` called on `pool`.
//
// The parser sees one file: it cannot know what `nextJob()` returns. It writes
// down the shape of the expression as a `ValueExpression`, and the graph
// builder, which knows every class, finds the type (src/model/callResolver.ts).
// Local variables are replaced here by what is known of them: their declared
// type, or for a variable declared with `auto`, the expression that gives it
// its value.
//
// Node types of the tree-sitter C++ grammar that are read:
//   identifier, this                       a variable, the object itself
//   field_expression                       `object.member`, `object->member`
//   call_expression                        any call; casts such as `static_cast<T>(x)` are
//                                          calls of a `template_function` in this grammar
//   new_expression, cast_expression,
//   compound_literal_expression            `new T`, `(T)x`, `T{...}`: the type is written
//   parenthesized_expression,
//   pointer_expression, subscript_expression   `*x`, `&x`, `x[i]`: indirection and the value inside.
//                                          An element of a container has a type named by the
//                                          type of the container, which is enough here.
//   number_literal, string_literal, raw_string_literal, concatenated_string, char_literal,
//   true, false, null                      a value written in the code. It matters as an
//                                          argument: `find(42)` and `find("name")` can be two
//                                          overloads that return different classes.
// Anything else (a lambda, an operator) is `unknown`.

import { TypeExpression, ValueExpression } from './fileSymbols';
import { SyntaxNode, normalizeWhitespace, removeTemplateArguments } from './syntaxHelpers';
import { readTypeExpression } from './typeReader';

/** What the code of a function says about one of its local variables or parameters. */
export interface LocalVariable {
  /** The declared type; undefined for a variable declared with `auto`. */
  type?: TypeExpression;
  /** For a variable declared with `auto`: the expression that gives it its value. */
  initializer?: SyntaxNode;
}

/** Functions of the standard library whose first template argument is the type of their result. */
const TYPE_MAKING_FUNCTIONS = new Set([
  'make_unique',
  'make_shared',
  'static_cast',
  'dynamic_cast',
  'const_cast',
  'reinterpret_cast',
  'static_pointer_cast',
  'dynamic_pointer_cast',
  'const_pointer_cast',
]);

/** Expressions nested deeper than this are not followed: it also stops `auto a = b; auto b = a;`. */
const MAX_DEPTH = 12;

const UNKNOWN: ValueExpression = { kind: 'unknown' };

export function readValueExpression(node: SyntaxNode | null, locals: Map<string, LocalVariable>, depth = 0): ValueExpression {
  if (node === null || depth > MAX_DEPTH) {
    return UNKNOWN;
  }
  const read = (inner: SyntaxNode | null) => readValueExpression(inner, locals, depth + 1);
  switch (node.type) {
    case 'this':
      return { kind: 'this' };
    case 'identifier':
      return readVariable(node.text, locals, depth);
    case 'field_expression':
      return readMember(node, read);
    case 'call_expression':
      return readCallResult(node, read);
    case 'new_expression': {
      const allocated = readWrittenType(node.childForFieldName('type'), null);
      if (allocated.kind === 'typed') allocated.type.indirection = 'pointer';
      return allocated;
    }
    case 'compound_literal_expression':
      return readWrittenType(node.childForFieldName('type'), null);
    case 'cast_expression':
      return readTypeDescriptor(node.childForFieldName('type'));
    case 'parenthesized_expression':
      return read(node.namedChildren[0] ?? null);
    case 'pointer_expression':
      return { kind: node.childForFieldName('operator')?.text === '&' ? 'address' : 'dereference', operand: read(node.childForFieldName('argument')) };
    case 'subscript_expression':
      return { kind: 'dereference', operand: read(node.childForFieldName('argument')) };
    case 'number_literal':
      return { kind: 'literal', literal: isFloatingNumber(node.text) ? 'floating' : 'integer' };
    case 'string_literal':
    case 'raw_string_literal':
    case 'concatenated_string':
      return { kind: 'literal', literal: 'string' };
    case 'char_literal':
      return { kind: 'literal', literal: 'character' };
    case 'true':
    case 'false':
      return { kind: 'literal', literal: 'boolean' };
    case 'null':
      // `nullptr` and `NULL`.
      return { kind: 'literal', literal: 'null' };
    case 'unary_expression': {
      // `-1` is still a number; the result of any other operator is not followed.
      const operand = read(node.childForFieldName('argument'));
      return operand.kind === 'literal' ? operand : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

/** `1.5`, `2e3` and `1.f` are floating-point numbers; `42`, `0x2e` and `10u` are integers. */
function isFloatingNumber(text: string): boolean {
  const isHexadecimal = /^0[xX]/.test(text);
  return !isHexadecimal && /[.eEfF]/.test(text);
}

/** The arguments of a call, each reduced to what tells its type. */
function readArguments(callExpression: SyntaxNode, read: (node: SyntaxNode | null) => ValueExpression): ValueExpression[] {
  const argumentList = callExpression.childForFieldName('arguments');
  return argumentList === null ? [] : argumentList.namedChildren.map((argument) => read(argument));
}

/** A name used as a value: a local variable, or else an attribute of the class. */
function readVariable(name: string, locals: Map<string, LocalVariable>, depth: number): ValueExpression {
  const local = locals.get(name);
  if (local === undefined) {
    return { kind: 'attribute', name };
  }
  if (local.type !== undefined) {
    return { kind: 'typed', type: local.type };
  }
  return readValueExpression(local.initializer ?? null, locals, depth + 1);
}

/** `object.member` or `object->member`. */
function readMember(fieldExpression: SyntaxNode, read: (node: SyntaxNode | null) => ValueExpression): ValueExpression {
  const fieldNode = fieldExpression.childForFieldName('field');
  if (fieldNode === null || fieldNode.type !== 'field_identifier') {
    return UNKNOWN;
  }
  const receiver = read(fieldExpression.childForFieldName('argument'));
  // `this->scene` is the attribute `scene`.
  return receiver.kind === 'this' ? { kind: 'attribute', name: fieldNode.text } : { kind: 'member', name: fieldNode.text, receiver };
}

/** The value that a call returns: `name(...)`, `object.name(...)`, `Scope::name(...)`, or a cast. */
function readCallResult(callExpression: SyntaxNode, read: (node: SyntaxNode | null) => ValueExpression): ValueExpression {
  const functionNode = callExpression.childForFieldName('function');
  if (functionNode === null) {
    return UNKNOWN;
  }
  if (functionNode.type === 'field_expression') {
    const fieldNode = functionNode.childForFieldName('field');
    const nameNode = fieldNode?.type === 'template_method' ? fieldNode.childForFieldName('name') : fieldNode;
    return nameNode === null || nameNode === undefined
      ? UNKNOWN
      : { kind: 'call', name: nameNode.text, arguments: readArguments(callExpression, read), receiver: read(functionNode.childForFieldName('argument')) };
  }
  if (functionNode.type !== 'identifier' && functionNode.type !== 'template_function' && functionNode.type !== 'qualified_identifier') {
    return UNKNOWN;
  }
  const fullName = removeTemplateArguments(normalizeWhitespace(functionNode.text)).replace(/^::/, '');
  const scopeEnd = fullName.lastIndexOf('::');
  const name = scopeEnd < 0 ? fullName : fullName.slice(scopeEnd + 2);
  if (TYPE_MAKING_FUNCTIONS.has(name)) {
    // `std::make_unique<Job>()`, `static_cast<Job*>(pointer)`: the type is the template argument.
    const typeDescriptor = functionNode.descendantsOfType('type_descriptor')[0] ?? null;
    return readTypeDescriptor(typeDescriptor);
  }
  if (scopeEnd < 0) {
    return { kind: 'call', name, arguments: readArguments(callExpression, read) };
  }
  const scopeName = fullName.slice(0, scopeEnd);
  // The result of another function of the standard library says nothing about project classes.
  const isStandardLibrary = scopeName === 'std' || scopeName.startsWith('std::');
  return isStandardLibrary ? UNKNOWN : { kind: 'call', name, arguments: readArguments(callExpression, read), scopeName };
}

/** A `type_descriptor` node: the type written between `<` and `>` or between the parentheses of a cast. */
function readTypeDescriptor(typeDescriptor: SyntaxNode | null): ValueExpression {
  if (typeDescriptor === null) {
    return UNKNOWN;
  }
  return readWrittenType(typeDescriptor.childForFieldName('type'), typeDescriptor.childForFieldName('declarator'));
}

function readWrittenType(typeNode: SyntaxNode | null, declarator: SyntaxNode | null): ValueExpression {
  return typeNode === null ? UNKNOWN : { kind: 'typed', type: readTypeExpression(typeNode, declarator) };
}
