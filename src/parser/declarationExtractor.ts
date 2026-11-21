// Walks the syntax tree of one C++ file and collects its declarations (spec §2.5).
//
// The walk starts at the root (`translation_unit`) and goes down through
// namespaces, `extern "C"` blocks, templates and every `#if` branch. It keeps
// track of the current scope (enclosing namespaces, classes and template
// parameters), because the names found in a declaration can only be resolved
// later if we know where they were written.

import { EntityKind, Visibility } from '../shared/graphModel';
import { collectBodyTypeReferences } from './bodyReferences';
import {
  BaseClass,
  FileSymbols,
  FriendDeclaration,
  LookupScope,
  OutOfClassMethod,
  TypeDeclaration,
  createEmptyFileSymbols,
} from './fileSymbols';
import {
  findFunctionDeclarator,
  readDeclaratorName,
  readFunctionBodyNodes,
  readInlineMethod,
  readMemberDeclaration,
  readParameterTypes,
} from './memberReader';
import {
  CLASS_SPECIFIER_TYPES,
  PREPROCESSOR_BLOCK_TYPES,
  SyntaxNode,
  childrenOf,
  lineOf,
  normalizeWhitespace,
} from './syntaxHelpers';
import { readQualifiedName, readTypeExpression } from './typeReader';

const ENTITY_KIND_BY_NODE_TYPE: Record<string, EntityKind> = {
  class_specifier: 'class',
  struct_specifier: 'struct',
  union_specifier: 'union',
  enum_specifier: 'enum',
};

/** Node types that can name a base class in a base class list. */
const BASE_TYPE_NODE_TYPES = new Set(['type_identifier', 'qualified_identifier', 'template_type']);

const TEMPLATE_PARAMETER_NAME_TYPES = new Set(['type_identifier', 'identifier']);

const ANONYMOUS_NAMESPACE = '(anonymous)';

export function extractFileSymbols(root: SyntaxNode, relativePath: string): FileSymbols {
  const extractor = new DeclarationExtractor(relativePath);
  extractor.walkDeclarations(root, { namespacePath: [], classPath: [], templateParameters: [] });
  extractor.symbols.parseErrorCount = root.descendantsOfType('ERROR').length;
  return extractor.symbols;
}

class DeclarationExtractor {
  readonly symbols: FileSymbols;

  constructor(relativePath: string) {
    this.symbols = createEmptyFileSymbols(relativePath, 0);
  }

  /** Visits the children of a node that contains declarations: a file, a namespace body, an `#if` branch. */
  walkDeclarations(container: SyntaxNode, scope: LookupScope): void {
    for (const child of container.namedChildren) {
      if (child !== null) {
        this.visitDeclaration(child, scope);
      }
    }
  }

  private visitDeclaration(node: SyntaxNode, scope: LookupScope): void {
    switch (node.type) {
      case 'namespace_definition':
        this.visitNamespace(node, scope);
        return;
      case 'class_specifier':
      case 'struct_specifier':
      case 'union_specifier':
      case 'enum_specifier':
        this.visitTypeSpecifier(node, scope, []);
        return;
      case 'declaration':
        this.visitVariableDeclaration(node, scope);
        return;
      case 'type_definition':
        this.visitTypedef(node, scope);
        return;
      case 'alias_declaration':
        this.visitAliasDeclaration(node, scope);
        return;
      case 'template_declaration':
        this.visitTemplate(node, scope);
        return;
      case 'function_definition':
        this.visitFunctionDefinition(node, scope);
        return;
      case 'using_declaration':
        this.visitUsing(node);
        return;
      case 'preproc_include':
        this.visitInclude(node);
        return;
      case 'linkage_specification': {
        const body = node.childForFieldName('body');
        if (body !== null) {
          this.walkDeclarations(body, scope);
        }
        return;
      }
      default:
        if (PREPROCESSOR_BLOCK_TYPES.has(node.type)) {
          this.walkDeclarations(node, scope);
        }
    }
  }

  private visitNamespace(node: SyntaxNode, scope: LookupScope): void {
    const nameNode = node.childForFieldName('name');
    // C++17 allows `namespace a::b { }`, which opens two namespaces at once.
    const names = nameNode === null ? [ANONYMOUS_NAMESPACE] : normalizeWhitespace(nameNode.text).split('::');
    const body = node.childForFieldName('body');
    if (body !== null) {
      this.walkDeclarations(body, { ...scope, namespacePath: [...scope.namespacePath, ...names] });
    }
  }

  /** `class Foo { ... } foo;` declares a class and a variable; only the class matters here. */
  private visitVariableDeclaration(node: SyntaxNode, scope: LookupScope): void {
    const typeNode = node.childForFieldName('type');
    if (typeNode !== null && isTypeDefinition(typeNode)) {
      this.visitTypeSpecifier(typeNode, scope, []);
    }
  }

  private visitTemplate(node: SyntaxNode, scope: LookupScope): void {
    const parameters = readTemplateParameterNames(node.childForFieldName('parameters'));
    const innerScope = { ...scope, templateParameters: [...scope.templateParameters, ...parameters] };
    for (const child of node.namedChildren) {
      if (child === null || child.type === 'template_parameter_list') {
        continue;
      }
      if (ENTITY_KIND_BY_NODE_TYPE[child.type] !== undefined) {
        this.visitTypeSpecifier(child, scope, parameters);
      } else {
        this.visitDeclaration(child, innerScope);
      }
    }
  }

  /**
   * Handles `class X { ... }`, `struct X;`, `enum class X { ... }` and their variants.
   * `nameOverride` names an anonymous type defined in a typedef: `typedef struct { ... } Name;`.
   */
  private visitTypeSpecifier(
    node: SyntaxNode,
    scope: LookupScope,
    templateParameters: string[],
    nameOverride?: string,
  ): void {
    const kind = ENTITY_KIND_BY_NODE_TYPE[node.type];
    const nameNode = node.childForFieldName('name');
    const body = node.childForFieldName('body');
    if (nameNode === null && nameOverride === undefined) {
      return; // Anonymous struct or union: it has no name to show.
    }

    // `class Outer::Inner { }` defines a nested class outside of its outer class.
    const writtenName = nameNode === null ? nameOverride! : readQualifiedName(nameNode);
    const nameParts = writtenName.split('::');
    const name = nameParts[nameParts.length - 1];
    const classPath = [...scope.classPath, ...nameParts.slice(0, -1)];
    const qualifiedName = [...scope.namespacePath, ...classPath, name].join('::');
    const namespaceName = scope.namespacePath.join('::');

    if (body === null) {
      this.symbols.forwardDeclarations.push({ qualifiedName, name, kind, namespace: namespaceName, line: lineOf(node) });
      return;
    }

    const declaration: TypeDeclaration = {
      qualifiedName,
      name,
      kind,
      namespace: namespaceName,
      outerClass: classPath.length > 0 ? [...scope.namespacePath, ...classPath].join('::') : undefined,
      line: lineOf(node),
      templateParameters: templateParameters.length > 0 ? templateParameters : undefined,
      bases: [],
      attributes: [],
      methods: [],
      friends: [],
      scope: {
        namespacePath: scope.namespacePath,
        classPath: [...classPath, name],
        templateParameters: [...scope.templateParameters, ...templateParameters],
      },
    };

    if (nameNode !== null && nameNode.type === 'template_type') {
      // `template <> class Buffer<int> { }` specializes the primary template `Buffer`.
      declaration.specializationOf = qualifiedName;
      declaration.specializationName = normalizeWhitespace(nameNode.text);
    }

    if (kind === 'enum') {
      declaration.enumValues = readEnumValues(body);
    } else {
      const defaultVisibility: Visibility = kind === 'class' ? 'private' : 'public';
      declaration.bases = readBaseClasses(node, defaultVisibility);
      this.walkClassBody(body, declaration, { current: defaultVisibility });
    }
    this.symbols.types.push(declaration);
  }

  /** `visibility` is an object so that `public:` inside an `#if` branch carries on after the branch. */
  private walkClassBody(body: SyntaxNode, declaration: TypeDeclaration, visibility: { current: Visibility }): void {
    for (const member of body.namedChildren) {
      if (member !== null) {
        this.visitClassMember(member, declaration, visibility);
      }
    }
  }

  private visitClassMember(member: SyntaxNode, declaration: TypeDeclaration, visibility: { current: Visibility }): void {
    const classScope = declaration.scope;
    switch (member.type) {
      case 'access_specifier':
        visibility.current = normalizeWhitespace(member.text).replace(':', '') as Visibility;
        return;
      case 'field_declaration':
      case 'declaration': {
        const typeNode = member.childForFieldName('type');
        if (typeNode !== null && ENTITY_KIND_BY_NODE_TYPE[typeNode.type] !== undefined) {
          this.visitNestedTypeInMember(typeNode, member, classScope);
        }
        const members = readMemberDeclaration(member, visibility.current);
        declaration.attributes.push(...members.attributes);
        declaration.methods.push(...members.methods);
        return;
      }
      case 'function_definition': {
        const method = readInlineMethod(member, visibility.current);
        if (method !== null) {
          declaration.methods.push(method);
        }
        return;
      }
      case 'template_declaration':
        this.visitMemberTemplate(member, declaration, visibility);
        return;
      case 'friend_declaration':
        declaration.friends.push(...readFriends(member));
        return;
      case 'alias_declaration':
        this.visitAliasDeclaration(member, classScope);
        return;
      case 'type_definition':
        this.visitTypedef(member, classScope);
        return;
      default:
        if (ENTITY_KIND_BY_NODE_TYPE[member.type] !== undefined) {
          this.visitTypeSpecifier(member, classScope, []);
        } else if (PREPROCESSOR_BLOCK_TYPES.has(member.type)) {
          this.walkClassBody(member, declaration, visibility);
        }
    }
  }

  /**
   * A member whose type is itself a type definition (`struct Inner { ... };` or `enum Mode { ... } mode;`)
   * declares a nested type. A member such as `class Impl;` forward-declares one.
   */
  private visitNestedTypeInMember(typeNode: SyntaxNode, member: SyntaxNode, classScope: LookupScope): void {
    const hasDeclarator = member.childForFieldName('declarator') !== null;
    if (isTypeDefinition(typeNode) || !hasDeclarator) {
      this.visitTypeSpecifier(typeNode, classScope, []);
    }
  }

  private visitMemberTemplate(node: SyntaxNode, declaration: TypeDeclaration, visibility: { current: Visibility }): void {
    const parameters = readTemplateParameterNames(node.childForFieldName('parameters'));
    for (const child of node.namedChildren) {
      if (child === null || child.type === 'template_parameter_list') {
        continue;
      }
      if (ENTITY_KIND_BY_NODE_TYPE[child.type] !== undefined) {
        this.visitTypeSpecifier(child, declaration.scope, parameters);
      } else {
        this.visitClassMember(child, declaration, visibility);
      }
    }
  }

  /** `typedef std::map<int, Item*> ItemMap;` or `typedef struct { ... } Point;`. */
  private visitTypedef(node: SyntaxNode, scope: LookupScope): void {
    const typeNode = node.childForFieldName('type');
    if (typeNode === null) {
      return;
    }
    const declarators = node.childrenForFieldName('declarator').filter((child): child is SyntaxNode => child !== null);
    if (isTypeDefinition(typeNode)) {
      const firstName = declarators.length > 0 ? readDeclaratorName(declarators[0]) : undefined;
      const isAnonymous = typeNode.childForFieldName('name') === null;
      this.visitTypeSpecifier(typeNode, scope, [], isAnonymous ? firstName : undefined);
      if (isAnonymous) {
        return; // The typedef name became the class name.
      }
    }
    for (const declarator of declarators) {
      this.symbols.aliases.push({
        qualifiedName: qualify(scope, readDeclaratorName(declarator)),
        type: readTypeExpression(typeNode, declarator),
        scope,
      });
    }
  }

  /** `using ItemList = std::vector<Item>;` */
  private visitAliasDeclaration(node: SyntaxNode, scope: LookupScope): void {
    const nameNode = node.childForFieldName('name');
    const typeDescriptor = node.childForFieldName('type');
    const typeNode = typeDescriptor?.childForFieldName('type') ?? null;
    if (nameNode === null || typeDescriptor === null || typeNode === null) {
      return;
    }
    this.symbols.aliases.push({
      qualifiedName: qualify(scope, normalizeWhitespace(nameNode.text)),
      type: readTypeExpression(typeNode, typeDescriptor.childForFieldName('declarator')),
      scope,
    });
  }

  /** Only methods defined outside their class are kept, such as `void Engine::run() { ... }`. */
  private visitFunctionDefinition(node: SyntaxNode, scope: LookupScope): void {
    const declarator = node.childForFieldName('declarator');
    const functionDeclarator = declarator === null ? null : findFunctionDeclarator(declarator);
    const nameNode = functionDeclarator?.childForFieldName('declarator') ?? null;
    if (functionDeclarator === null || nameNode === null || nameNode.type !== 'qualified_identifier') {
      return; // A free function: ignored (spec §3).
    }
    const qualifiedMethodName = readQualifiedName(nameNode);
    const ownerEnd = qualifiedMethodName.lastIndexOf('::');
    if (ownerEnd <= 0) {
      return;
    }

    const signatureTypes = readParameterTypes(functionDeclarator);
    const returnTypeNode = node.childForFieldName('type');
    if (returnTypeNode !== null) {
      signatureTypes.push(readTypeExpression(returnTypeNode, declarator));
    }
    const method: OutOfClassMethod = {
      ownerName: qualifiedMethodName.slice(0, ownerEnd),
      scope,
      signatureTypes,
      bodyReferences: collectBodyTypeReferences(readFunctionBodyNodes(node)),
      line: lineOf(node),
    };
    this.symbols.outOfClassMethods.push(method);
  }

  /** Records `using namespace X;`. Other using declarations are ignored. */
  private visitUsing(node: SyntaxNode): void {
    const text = normalizeWhitespace(node.text);
    const match = /^using namespace ([\w:]+)/.exec(text);
    if (match !== null) {
      this.symbols.usingNamespaces.push(match[1].replace(/^::/, ''));
    }
  }

  private visitInclude(node: SyntaxNode): void {
    const pathNode = node.childForFieldName('path');
    if (pathNode === null) {
      return;
    }
    if (pathNode.type === 'system_lib_string') {
      this.symbols.includes.push({ path: pathNode.text.slice(1, -1), isSystem: true, line: lineOf(node) });
    } else if (pathNode.type === 'string_literal') {
      const content = pathNode.namedChildren.find((child) => child !== null && child.type === 'string_content');
      if (content !== undefined && content !== null) {
        this.symbols.includes.push({ path: content.text, isSystem: false, line: lineOf(node) });
      }
    }
  }
}

/** True for a class, struct, union or enum specifier that has a body, as opposed to a mere mention. */
function isTypeDefinition(node: SyntaxNode): boolean {
  return ENTITY_KIND_BY_NODE_TYPE[node.type] !== undefined && node.childForFieldName('body') !== null;
}

function qualify(scope: LookupScope, name: string): string {
  return [...scope.namespacePath, ...scope.classPath, name].join('::');
}

/**
 * Reads `: public Base<T>, protected virtual Other`. The base list is a flat sequence of tokens,
 * so the access and `virtual` keywords seen before each type apply to that type.
 */
function readBaseClasses(classNode: SyntaxNode, defaultAccess: Visibility): BaseClass[] {
  const clause = classNode.namedChildren.find((child) => child !== null && child.type === 'base_class_clause');
  if (clause === undefined || clause === null) {
    return [];
  }
  const bases: BaseClass[] = [];
  let access = defaultAccess;
  let isVirtual = false;
  for (const token of childrenOf(clause)) {
    if (token.type === 'access_specifier') {
      access = normalizeWhitespace(token.text) as Visibility;
    } else if (token.type === 'virtual') {
      isVirtual = true;
    } else if (token.type === ',') {
      access = defaultAccess;
      isVirtual = false;
    } else if (BASE_TYPE_NODE_TYPES.has(token.type)) {
      bases.push({ type: readTypeExpression(token, null), access, isVirtual, line: lineOf(token) });
    }
  }
  return bases;
}

function readEnumValues(body: SyntaxNode): string[] {
  const values: string[] = [];
  for (const child of body.namedChildren) {
    if (child === null) {
      continue;
    }
    if (child.type === 'enumerator') {
      const nameNode = child.childForFieldName('name');
      if (nameNode !== null) {
        values.push(nameNode.text);
      }
    } else if (PREPROCESSOR_BLOCK_TYPES.has(child.type)) {
      values.push(...readEnumValues(child));
    }
  }
  return values;
}

/** `friend class Inspector;` names a class. `friend void f();` declares a function and is skipped. */
function readFriends(node: SyntaxNode): FriendDeclaration[] {
  const friends: FriendDeclaration[] = [];
  for (const child of node.namedChildren) {
    if (child === null) {
      continue;
    }
    if (BASE_TYPE_NODE_TYPES.has(child.type)) {
      friends.push({ name: readQualifiedName(child), line: lineOf(node) });
    } else if (CLASS_SPECIFIER_TYPES.has(child.type)) {
      const nameNode = child.childForFieldName('name');
      if (nameNode !== null) {
        friends.push({ name: readQualifiedName(nameNode), line: lineOf(node) });
      }
    }
  }
  return friends;
}

/** `template <typename T, int N = 3>` gives ['T', 'N']. */
function readTemplateParameterNames(parameterList: SyntaxNode | null): string[] {
  if (parameterList === null) {
    return [];
  }
  const names: string[] = [];
  for (const parameter of parameterList.namedChildren) {
    if (parameter === null) {
      continue;
    }
    const nameNode =
      parameter.childForFieldName('name') ??
      parameter.childForFieldName('declarator') ??
      parameter.namedChildren.find((child) => child !== null && TEMPLATE_PARAMETER_NAME_TYPES.has(child.type)) ??
      null;
    if (nameNode !== null) {
      names.push(readDeclaratorName(nameNode));
    }
  }
  return names;
}
