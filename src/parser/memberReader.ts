// Reads the members of a class body: attributes and methods.
//
// In the tree-sitter C++ grammar, a member is one of:
//   - `field_declaration`: an attribute (`int count;`) or a method declaration
//     (`void draw() const;`). It is a method when its declarator chain
//     contains a `function_declarator`;
//   - `declaration`: a constructor or destructor declaration, which has no type;
//   - `function_definition`: a method defined inside the class, with its body.
// Several names can share one declaration (`Foo a, *b;`), so a declaration
// yields a list of members.

import { MemberFlags, Visibility } from '../shared/graphModel';
import { collectBodyTypeReferences } from './bodyReferences';
import { collectCallReferences } from './callReferences';
import { RawAttribute, RawMethod, TypeExpression } from './fileSymbols';
import { SyntaxNode, hasChildOfType, hasChildWithText, lineOf, normalizeWhitespace } from './syntaxHelpers';
import { innerDeclarator, readDeclaratorName, readTypeExpression, readTypeText } from './typeReader';

const PARAMETER_TYPES = new Set([
  'parameter_declaration',
  'optional_parameter_declaration',
  'variadic_parameter_declaration',
]);

export interface MemberList {
  attributes: RawAttribute[];
  methods: RawMethod[];
}

/** Reads a `field_declaration` or a `declaration` found in a class body. */
export function readMemberDeclaration(node: SyntaxNode, visibility: Visibility): MemberList {
  const members: MemberList = { attributes: [], methods: [] };
  const typeNode = node.childForFieldName('type');
  const isStatic = hasChildWithText(node, 'storage_class_specifier', 'static');
  const isVirtual = hasChildOfType(node, 'virtual');
  const isConstType = hasChildWithText(node, 'type_qualifier', 'const');
  // `= 0` after a method declaration makes it pure virtual.
  const isPure = node.childForFieldName('default_value')?.text === '0';

  for (const declarator of node.childrenForFieldName('declarator')) {
    if (declarator === null) {
      continue;
    }
    const functionDeclarator = findFunctionDeclarator(declarator);
    if (functionDeclarator !== null) {
      let flags = 0;
      if (isStatic) flags |= MemberFlags.Static;
      if (isVirtual || isPure) flags |= MemberFlags.Virtual;
      if (isPure) flags |= MemberFlags.PureVirtual;
      members.methods.push(
        buildMethod({ typeNode, declarator, functionDeclarator, isConstType, flags, visibility, bodyNodes: [] }),
      );
    } else if (typeNode !== null) {
      members.attributes.push({
        name: readDeclaratorName(declarator),
        typeText: readAttributeTypeText(typeNode, declarator, isConstType),
        type: readTypeExpression(typeNode, declarator),
        visibility,
        isStatic,
        line: lineOf(declarator),
      });
    }
  }
  return members;
}

/** Reads a method defined inside a class body. Returns null for anything that is not a method. */
export function readInlineMethod(node: SyntaxNode, visibility: Visibility): RawMethod | null {
  const declarator = node.childForFieldName('declarator');
  if (declarator === null) {
    return null;
  }
  const functionDeclarator = findFunctionDeclarator(declarator);
  if (functionDeclarator === null) {
    return null;
  }
  let flags = 0;
  if (hasChildWithText(node, 'storage_class_specifier', 'static')) flags |= MemberFlags.Static;
  if (hasChildOfType(node, 'virtual')) flags |= MemberFlags.Virtual;
  return buildMethod({
    typeNode: node.childForFieldName('type'),
    declarator,
    functionDeclarator,
    isConstType: hasChildWithText(node, 'type_qualifier', 'const'),
    flags,
    visibility,
    bodyNodes: readFunctionBodyNodes(node),
  });
}

/** The body of a function definition and its constructor initializer list, if any. */
export function readFunctionBodyNodes(functionDefinition: SyntaxNode): SyntaxNode[] {
  const bodyNodes: SyntaxNode[] = [];
  const body = functionDefinition.childForFieldName('body');
  if (body !== null) {
    bodyNodes.push(body);
  }
  for (const child of functionDefinition.namedChildren) {
    if (child !== null && child.type === 'field_initializer_list') {
      bodyNodes.push(child);
    }
  }
  return bodyNodes;
}

/**
 * Finds the `function_declarator` in a declarator chain such as `pointer_declarator > function_declarator`
 * (a method returning a pointer). Returns null for attributes, including function pointers like
 * `void (*callback)(int)`, whose function declarator wraps a parenthesized declarator.
 */
export function findFunctionDeclarator(declarator: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = declarator;
  while (current !== null) {
    if (current.type === 'function_declarator') {
      const declaredName = current.childForFieldName('declarator');
      return declaredName !== null && declaredName.type === 'parenthesized_declarator' ? null : current;
    }
    current = innerDeclarator(current);
  }
  return null;
}

/** Like readTypeText, but shows a function pointer `void (*callback)(int)` as `void (*)(int)`. */
function readAttributeTypeText(typeNode: SyntaxNode, declarator: SyntaxNode, isConstType: boolean): string {
  let current: SyntaxNode | null = declarator;
  while (current !== null && current.type !== 'function_declarator') {
    current = innerDeclarator(current);
  }
  if (current === null) {
    return readTypeText(typeNode, declarator, isConstType);
  }
  const parameters = current.childForFieldName('parameters');
  const parametersText = parameters === null ? '()' : normalizeWhitespace(parameters.text);
  return `${readTypeText(typeNode, null, isConstType)} (*)${parametersText}`;
}

/** The types of the parameters of a function declarator. */
export function readParameterTypes(functionDeclarator: SyntaxNode): TypeExpression[] {
  const parameterList = functionDeclarator.childForFieldName('parameters');
  if (parameterList === null) {
    return [];
  }
  const types: TypeExpression[] = [];
  for (const parameter of parameterList.namedChildren) {
    if (parameter === null || !PARAMETER_TYPES.has(parameter.type)) {
      continue;
    }
    const typeNode = parameter.childForFieldName('type');
    if (typeNode !== null) {
      types.push(readTypeExpression(typeNode, parameter.childForFieldName('declarator')));
    }
  }
  return types;
}

interface MethodParts {
  /** The return type node; null for constructors and destructors. */
  typeNode: SyntaxNode | null;
  /** The whole declarator chain, whose pointer and reference markers apply to the return type. */
  declarator: SyntaxNode;
  functionDeclarator: SyntaxNode;
  isConstType: boolean;
  flags: number;
  visibility: Visibility;
  bodyNodes: SyntaxNode[];
}

function buildMethod(parts: MethodParts): RawMethod {
  const { typeNode, declarator, functionDeclarator } = parts;
  let flags = parts.flags;
  if (hasChildWithText(functionDeclarator, 'type_qualifier', 'const')) {
    flags |= MemberFlags.Const;
  }
  // `override` and `final` are only allowed on virtual methods.
  if (hasChildOfType(functionDeclarator, 'virtual_specifier')) {
    flags |= MemberFlags.Virtual;
  }

  const parameterList = functionDeclarator.childForFieldName('parameters');
  const parametersText = parameterList === null ? '()' : normalizeWhitespace(parameterList.text);
  const constText = (flags & MemberFlags.Const) !== 0 ? ' const' : '';
  const returnText = typeNode === null ? '' : `: ${readTypeText(typeNode, declarator, parts.isConstType)}`;

  const signatureTypes = readParameterTypes(functionDeclarator);
  if (typeNode !== null) {
    signatureTypes.push(readTypeExpression(typeNode, declarator));
  }

  return {
    name: readDeclaratorName(functionDeclarator.childForFieldName('declarator')),
    signature: parametersText + constText + returnText,
    visibility: parts.visibility,
    flags,
    line: lineOf(functionDeclarator),
    signatureTypes,
    bodyReferences: collectBodyTypeReferences(parts.bodyNodes),
    calls: collectCallReferences(functionDeclarator, parts.bodyNodes),
  };
}
