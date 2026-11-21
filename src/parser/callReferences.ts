// Collects the method calls made by the code of a method (spec §3.1).
//
// The parser sees one file and has no compiler: it cannot know which class a
// called method belongs to. It records what the source says about each call,
// and the graph builder (src/model/callResolver.ts) decides later:
//   - the name of the called method;
//   - what it is called on: nothing or `this` (`update()`), a class named
//     before `::` (`Registry::instance()`), a variable (`scene->add()`) or any
//     other expression (`factory().create()`);
//   - for a variable that is a parameter or a local variable of the method,
//     its declared type, which names the class. Attributes of the class are
//     found later, by their name: they are declared elsewhere, often in
//     another file.
//
// In the tree-sitter C++ grammar a call is a `call_expression` whose
// `function` field is:
//   - a `field_expression` for `object.method` and `object->method`, with the
//     fields `argument` (the object) and `field` (the method);
//   - a `qualified_identifier` for `Scope::method`;
//   - an `identifier` or a `template_function` for a plain `method(...)`.

import { CallReference, TypeExpression } from './fileSymbols';
import { SyntaxNode, lineOf, normalizeWhitespace, removeTemplateArguments } from './syntaxHelpers';
import { readDeclaratorName, readTypeExpression } from './typeReader';

const PARAMETER_NODE_TYPES = ['parameter_declaration', 'optional_parameter_declaration'];

/**
 * The calls made in the body of a function, each kept once with the line of its first
 * occurrence. `functionDeclarator` gives the parameters; `bodyNodes` are the body and the
 * constructor initializer list.
 */
export function collectCallReferences(functionDeclarator: SyntaxNode, bodyNodes: SyntaxNode[]): CallReference[] {
  if (bodyNodes.length === 0) {
    return [];
  }
  const variableTypes = readVariableTypes(functionDeclarator, bodyNodes);
  const callsByKey = new Map<string, CallReference>();
  for (const bodyNode of bodyNodes) {
    // descendantsOfType runs inside tree-sitter, which is much faster than walking the tree in JavaScript.
    for (const callNode of bodyNode.descendantsOfType('call_expression')) {
      const functionNode = callNode === null ? null : callNode.childForFieldName('function');
      const call = callNode === null || functionNode === null ? undefined : readCall(functionNode, lineOf(callNode), variableTypes);
      if (call === undefined) {
        continue;
      }
      const key = `${call.receiverKind}|${call.receiverName ?? ''}|${call.name}`;
      if (!callsByKey.has(key)) {
        callsByKey.set(key, call);
      }
    }
  }
  return Array.from(callsByKey.values());
}

/**
 * The declared types of the parameters and of the local variables, by name. A variable
 * declared with `auto` is in the map with an empty type name: it is known to be a local
 * variable, of an unknown type.
 */
function readVariableTypes(functionDeclarator: SyntaxNode, bodyNodes: SyntaxNode[]): Map<string, TypeExpression> {
  const types = new Map<string, TypeExpression>();
  const add = (typeNode: SyntaxNode | null, declarator: SyntaxNode | null) => {
    if (typeNode !== null && declarator !== null) {
      types.set(readDeclaratorName(declarator), readTypeExpression(typeNode, declarator));
    }
  };
  const parameterList = functionDeclarator.childForFieldName('parameters');
  for (const parameter of parameterList === null ? [] : parameterList.descendantsOfType(PARAMETER_NODE_TYPES)) {
    if (parameter !== null) {
      add(parameter.childForFieldName('type'), parameter.childForFieldName('declarator'));
    }
  }
  for (const bodyNode of bodyNodes) {
    // `Timer timer;`, `Shape* a = first, *b = second;` and `for (const Shape& shape : shapes)`.
    for (const declaration of bodyNode.descendantsOfType(['declaration', 'for_range_loop'])) {
      if (declaration === null) {
        continue;
      }
      for (const declarator of declaration.childrenForFieldName('declarator')) {
        add(declaration.childForFieldName('type'), declarator);
      }
    }
  }
  return types;
}

function readCall(functionNode: SyntaxNode, line: number, variableTypes: Map<string, TypeExpression>): CallReference | undefined {
  switch (functionNode.type) {
    case 'identifier':
      return { name: functionNode.text, line, receiverKind: 'own' };
    case 'template_function': {
      const nameNode = functionNode.childForFieldName('name');
      return nameNode === null ? undefined : { name: nameNode.text, line, receiverKind: 'own' };
    }
    case 'qualified_identifier':
      return readScopedCall(functionNode, line);
    case 'field_expression':
      return readMemberCall(functionNode, line, variableTypes);
    default:
      return undefined;
  }
}

/** `Registry::instance()` or `Base::update()`. Calls into the standard library are skipped. */
function readScopedCall(qualifiedIdentifier: SyntaxNode, line: number): CallReference | undefined {
  const fullName = removeTemplateArguments(normalizeWhitespace(qualifiedIdentifier.text)).replace(/^::/, '');
  const scopeEnd = fullName.lastIndexOf('::');
  if (scopeEnd <= 0) {
    return undefined;
  }
  const scopeName = fullName.slice(0, scopeEnd);
  if (scopeName === 'std' || scopeName.startsWith('std::')) {
    return undefined;
  }
  return { name: fullName.slice(scopeEnd + 2), line, receiverKind: 'scope', receiverName: scopeName };
}

/** `object.method()` or `object->method()`. */
function readMemberCall(fieldExpression: SyntaxNode, line: number, variableTypes: Map<string, TypeExpression>): CallReference | undefined {
  const name = readCalledMethodName(fieldExpression.childForFieldName('field'));
  const object = fieldExpression.childForFieldName('argument');
  if (name === undefined || object === null) {
    return undefined;
  }
  if (object.type === 'this') {
    return { name, line, receiverKind: 'own' };
  }
  if (object.type === 'identifier') {
    const type = variableTypes.get(object.text);
    if (type === undefined) {
      // Not a parameter or a local variable: an attribute of the class, most of the time.
      return { name, line, receiverKind: 'variable', receiverName: object.text };
    }
    if (type.name === '' && type.templateArguments.length === 0) {
      // A local variable declared with `auto`: its type is not written.
      return { name, line, receiverKind: 'expression' };
    }
    return { name, line, receiverKind: 'variable', receiverName: object.text, receiverType: type };
  }
  // `this->scene->add()`: the object is the attribute `scene`.
  const isAttributeOfThis = object.type === 'field_expression' && object.childForFieldName('argument')?.type === 'this';
  const attributeNode = isAttributeOfThis ? object.childForFieldName('field') : null;
  if (attributeNode !== null && attributeNode.type === 'field_identifier') {
    return { name, line, receiverKind: 'variable', receiverName: attributeNode.text };
  }
  return { name, line, receiverKind: 'expression' };
}

/** The method name of `object.method` or of `object.method<T>`; undefined for a destructor call. */
function readCalledMethodName(fieldNode: SyntaxNode | null): string | undefined {
  if (fieldNode === null) {
    return undefined;
  }
  if (fieldNode.type === 'field_identifier') {
    return fieldNode.text;
  }
  if (fieldNode.type === 'template_method') {
    return fieldNode.childForFieldName('name')?.text;
  }
  return undefined;
}
