// What the parser extracts from one C++ file, before any name resolution.
//
// The parser runs in worker threads and only sees one file at a time, so it
// cannot know which class a type name refers to. It records type names as
// written in the source, together with the scope they appear in. The graph
// builder (src/model) later merges the results of all files and resolves the
// names. Everything here is plain data so it can be sent between threads.

import { EntityKind, Visibility } from '../shared/graphModel';

/**
 * A type as written in the source, for example `const std::vector<Foo*>&`
 * becomes { name: 'std::vector', templateArguments: [{ name: 'Foo', indirection: 'pointer' }],
 * indirection: 'reference' }.
 */
export interface TypeExpression {
  /** Name without template arguments, qualified as written: `std::vector`, `Foo`, `int`. */
  name: string;
  templateArguments: TypeExpression[];
  indirection: 'value' | 'pointer' | 'reference';
  isArray: boolean;
}

/** The context needed to resolve a name: where in the code the name appears. */
export interface LookupScope {
  /** Enclosing namespaces, outermost first, for example ['app', 'core']. */
  namespacePath: string[];
  /** Enclosing classes inside the namespace, outermost first. Includes the class itself for its members. */
  classPath: string[];
  /** Template parameter names visible in the scope. They never refer to a project class. */
  templateParameters: string[];
}

export interface BaseClass {
  type: TypeExpression;
  access: Visibility;
  isVirtual: boolean;
  line: number;
}

/** A type name used in the body of a method, with the first line that uses it. */
export interface BodyTypeReference {
  name: string;
  line: number;
}

/** A method call found in the code of a method, as written in the source (spec §3.1). */
export interface CallReference {
  /** Name of the called method, for example `add` in `scene->add(shape)`. */
  name: string;
  line: number;
  /**
   * What the method is called on:
   *   - `own`: nothing, or `this`, as in `update()` and `this->update()`;
   *   - `scope`: a class named before `::`, as in `Registry::instance()`;
   *   - `variable`: a variable, as in `scene->add(shape)`;
   *   - `expression`: anything else, as in `factory().create()`.
   */
  receiverKind: 'own' | 'scope' | 'variable' | 'expression';
  /** The name of the scope or of the variable. */
  receiverName?: string;
  /** The declared type of the variable, when it is a parameter or a local variable of the method. */
  receiverType?: TypeExpression;
}

/** `friend class X;` */
export interface FriendDeclaration {
  /** The class name as written, for example `ns::Auditor`. */
  name: string;
  line: number;
}

export interface RawAttribute {
  name: string;
  /** The type as displayed on the card, for example `std::vector<Item*>`. */
  typeText: string;
  type: TypeExpression;
  visibility: Visibility;
  isStatic: boolean;
  line: number;
}

export interface RawMethod {
  name: string;
  /** Parameters, qualifiers and return type as displayed on the card, for example `(int x) const: void`. */
  signature: string;
  visibility: Visibility;
  /** Combination of MemberFlags. */
  flags: number;
  line: number;
  /** Types of the parameters and of the return value. */
  signatureTypes: TypeExpression[];
  /** Type names used in the body, when the method is defined inside the class. */
  bodyReferences: BodyTypeReference[];
  /** Method calls made in the body, when the method is defined inside the class. */
  calls: CallReference[];
}

export interface TypeDeclaration {
  /** Qualified name, for example `app::core::Engine` or `app::Outer::Inner`. */
  qualifiedName: string;
  name: string;
  kind: EntityKind;
  /** Enclosing namespace, `app::core`, or an empty string. */
  namespace: string;
  /** Qualified name of the enclosing class, for nested classes. */
  outerClass?: string;
  line: number;
  templateParameters?: string[];
  /** Set when this declaration is a template specialization: the qualified name of the primary template. */
  specializationOf?: string;
  /** Display name of the specialization, for example `Buffer<int>`. */
  specializationName?: string;
  bases: BaseClass[];
  attributes: RawAttribute[];
  methods: RawMethod[];
  friends: FriendDeclaration[];
  enumValues?: string[];
  /** Scope used to resolve the names that appear in the declaration. */
  scope: LookupScope;
}

export interface ForwardDeclaration {
  qualifiedName: string;
  name: string;
  kind: EntityKind;
  namespace: string;
  line: number;
}

/** `typedef` or `using X = ...`. */
export interface TypeAlias {
  qualifiedName: string;
  type: TypeExpression;
  scope: LookupScope;
}

/** A method defined outside its class, for example `void Engine::run() { ... }` in a .cpp file. */
export interface OutOfClassMethod {
  /** Owner class name as written, without template arguments, for example `core::Engine`. */
  ownerName: string;
  /** Name of the method, for example `run`. */
  name: string;
  /** Scope of the definition, used to resolve the owner name. */
  scope: LookupScope;
  signatureTypes: TypeExpression[];
  bodyReferences: BodyTypeReference[];
  calls: CallReference[];
  line: number;
}

export interface IncludeDirective {
  path: string;
  isSystem: boolean;
  line: number;
}

export interface FileSymbols {
  /** Path relative to the root of the graph (the scanned folder, in general), with forward slashes. */
  file: string;
  includes: IncludeDirective[];
  /** Namespaces made visible by `using namespace X;` anywhere in the file. */
  usingNamespaces: string[];
  types: TypeDeclaration[];
  forwardDeclarations: ForwardDeclaration[];
  aliases: TypeAlias[];
  outOfClassMethods: OutOfClassMethod[];
  /** Number of syntax errors tree-sitter reported in the file. */
  parseErrorCount: number;
}

export function createEmptyFileSymbols(relativePath: string, parseErrorCount: number): FileSymbols {
  return {
    file: relativePath,
    includes: [],
    usingNamespaces: [],
    types: [],
    forwardDeclarations: [],
    aliases: [],
    outOfClassMethods: [],
    parseErrorCount,
  };
}
