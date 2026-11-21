// Builds the class graph from the symbols of every parsed file (spec §2.5, §2.6, §3).
//
// The steps are:
//   1. merge the declarations of each class: a class can be declared in
//      several `#if` branches, and its methods can be defined in .cpp files;
//   2. create "external" nodes for classes that are only forward-declared;
//   3. resolve every type name and create the edges of the seven relation kinds;
//   4. find the file that implements each class, when it is not the file that declares it;
//   5. find the class that each method call goes to (callResolver.ts);
//   6. list what the functions that belong to no class use of the classes.

import {
  BodyTypeReference,
  FileSymbols,
  FreeFunction,
  LookupScope,
  OutOfClassMethod,
  TypeDeclaration,
  TypeExpression,
} from '../parser/fileSymbols';
import { collectTypeNames } from '../parser/typeReader';
import { ClassNode, FunctionUse, Graph, Member, MemberFlags, SourceLocation } from '../shared/graphModel';
import { CallResolver, CallableSignature, DeclaredFunction, DeclaredMemberTypes, FunctionCode, MethodCode } from './callResolver';
import { EdgeCollector } from './edgeCollector';
import { ImplementationFinder } from './implementationFinder';
import { IncludeResolver } from './includeResolver';
import { MemberRelationClassifier } from './memberRelations';
import { MethodDefinitions } from './methodDefinitions';
import { TypeResolver } from './typeResolver';

export interface GraphBuildResult {
  graph: Graph;
  /** Number of occurrences of each type name that matched no project class. */
  unresolvedTypeNames: Map<string, number>;
}

/** A declaration together with the file it comes from. */
interface LocatedDeclaration {
  declaration: TypeDeclaration;
  fileSymbols: FileSymbols;
}

export function buildGraph(root: string, allFileSymbols: FileSymbols[]): GraphBuildResult {
  return new GraphBuilder(root, allFileSymbols).build();
}

class GraphBuilder {
  private readonly fileSymbolsList: FileSymbols[];
  private readonly fileIndexByPath = new Map<string, number>();
  private readonly nodesById = new Map<string, ClassNode>();
  private readonly declarationsById = new Map<string, LocatedDeclaration[]>();
  /** For include edges: the classes declared in each file, or whose methods are defined in it. */
  private readonly classIdsByFile = new Map<string, Set<string>>();
  private readonly declaredClassIdsByFile = new Map<string, Set<string>>();
  /** For each class, the files that define its methods outside of it, with the line of the first one. */
  private readonly definitionLinesById = new Map<string, Map<number, number>>();
  /** Gives each method defined outside its class the place of its code (methodDefinitions.ts). */
  private readonly methodDefinitions = new MethodDefinitions();
  private readonly edges = new EdgeCollector();
  /** The methods that have code, for the search of their calls once every relation is known. */
  private readonly methodCodes: MethodCode[] = [];
  /** The same for the free functions, and the classes that they name (spec §3.2). */
  private readonly functionCodes: FunctionCode[] = [];
  private readonly functionDependencies: FunctionUse[] = [];
  private readonly unresolvedTypeNames = new Map<string, number>();
  private resolver!: TypeResolver;
  private classifier!: MemberRelationClassifier;

  constructor(
    private readonly root: string,
    allFileSymbols: FileSymbols[],
  ) {
    // Sorting makes the result independent of the order in which worker threads finish.
    this.fileSymbolsList = [...allFileSymbols].sort((first, second) => first.file.localeCompare(second.file));
    this.fileSymbolsList.forEach((symbols, index) => this.fileIndexByPath.set(symbols.file, index));
  }

  build(): GraphBuildResult {
    this.mergeTypeDeclarations();
    this.addExternalNodes();

    const aliases = this.fileSymbolsList.flatMap((symbols) => symbols.aliases);
    this.resolver = new TypeResolver(this.nodesById.keys(), aliases);
    this.classifier = new MemberRelationClassifier(this.resolver);

    for (const [id, declarations] of this.declarationsById) {
      for (const located of declarations) {
        this.addDeclarationEdges(id, located);
      }
    }
    for (const fileSymbols of this.fileSymbolsList) {
      for (const method of fileSymbols.outOfClassMethods) {
        this.addOutOfClassMethod(method, fileSymbols);
      }
      for (const freeFunction of fileSymbols.freeFunctions) {
        this.addFreeFunction(freeFunction, freeFunction.name, fileSymbols);
      }
    }
    this.addIncludeEdges();
    this.findImplementations();
    for (const name of this.classifier.unresolvedNames) {
      this.countUnresolved(name);
    }

    const edges = this.edges.toEdges();
    const callResolver = new CallResolver(this.nodesById, this.resolver, this.declaredMemberTypes(), this.declaredFunctions(), edges);
    const graph: Graph = {
      root: this.root,
      nodes: Array.from(this.nodesById.values()),
      edges,
      calls: callResolver.resolve(this.methodCodes),
      functionUses: [...this.functionDependencies, ...callResolver.resolveFunctionCalls(this.functionCodes)],
      files: this.fileSymbolsList.map((symbols) => symbols.file),
    };
    return { graph, unresolvedTypeNames: this.unresolvedTypeNames };
  }

  // ---- Step 1: nodes ----

  private mergeTypeDeclarations(): void {
    const specializations: LocatedDeclaration[] = [];
    for (const fileSymbols of this.fileSymbolsList) {
      for (const declaration of fileSymbols.types) {
        if (declaration.specializationOf !== undefined) {
          specializations.push({ declaration, fileSymbols });
        } else {
          this.addDeclaration({ declaration, fileSymbols });
        }
      }
    }
    for (const located of specializations) {
      this.attachSpecialization(located);
    }
  }

  private addDeclaration(located: LocatedDeclaration): void {
    const { declaration, fileSymbols } = located;
    const id = declaration.qualifiedName;
    const fileIndex = this.fileIndexByPath.get(fileSymbols.file)!;
    let node = this.nodesById.get(id);
    if (node === undefined) {
      node = {
        id,
        name: declaration.name,
        kind: declaration.kind,
        namespace: declaration.namespace,
        file: fileIndex,
        line: declaration.line,
        templateParams: declaration.templateParameters,
        isAbstract: false,
        isExternal: false,
        attributes: [],
        methods: [],
        enumValues: declaration.enumValues,
      };
      this.nodesById.set(id, node);
      this.declarationsById.set(id, []);
    }
    this.declarationsById.get(id)!.push(located);
    (node.sourceRanges ??= []).push({ file: fileIndex, ...declaration.sourceRange });
    this.mergeMembers(node, declaration, fileIndex);
    addToSetMap(this.classIdsByFile, fileSymbols.file, id);
    addToSetMap(this.declaredClassIdsByFile, fileSymbols.file, id);
  }

  /** Adds the members of a declaration that the node does not have yet. */
  private mergeMembers(node: ClassNode, declaration: TypeDeclaration, fileIndex: number): void {
    const known = new Set([...node.attributes, ...node.methods].map(memberKey));
    for (const attribute of declaration.attributes) {
      let flags = 0;
      if (attribute.isStatic) flags |= MemberFlags.Static;
      const member: Member = {
        name: attribute.name,
        signature: attribute.typeText,
        visibility: attribute.visibility,
        flags,
        file: fileIndex,
        line: attribute.line,
      };
      addIfUnknown(node.attributes, member, known);
    }
    for (const method of declaration.methods) {
      const member: Member = {
        name: method.name,
        signature: method.signature,
        visibility: method.visibility,
        flags: method.flags,
        file: fileIndex,
        line: method.line,
      };
      if (addIfUnknown(node.methods, member, known)) {
        this.methodDefinitions.addDeclaredMethod(node.id, member, method.signatureTypes);
      }
    }
    node.isAbstract = node.methods.some((method) => (method.flags & MemberFlags.PureVirtual) !== 0);
  }

  /** A specialization is listed on its primary template's card instead of being a node of its own. */
  private attachSpecialization(located: LocatedDeclaration): void {
    const { declaration } = located;
    const primary = this.nodesById.get(declaration.specializationOf!);
    if (primary === undefined) {
      // The primary template is not in the scanned files: the specialization stands for it.
      this.addDeclaration(located);
      const node = this.nodesById.get(declaration.qualifiedName)!;
      addUnique((node.specializations ??= []), declaration.specializationName!);
      return;
    }
    addUnique((primary.specializations ??= []), declaration.specializationName!);
    (primary.sourceRanges ??= []).push({ file: this.fileIndexByPath.get(located.fileSymbols.file)!, ...declaration.sourceRange });
  }

  private addExternalNodes(): void {
    for (const fileSymbols of this.fileSymbolsList) {
      for (const forward of fileSymbols.forwardDeclarations) {
        if (this.nodesById.has(forward.qualifiedName)) {
          continue;
        }
        this.nodesById.set(forward.qualifiedName, {
          id: forward.qualifiedName,
          name: forward.name,
          kind: forward.kind,
          namespace: forward.namespace,
          file: this.fileIndexByPath.get(fileSymbols.file)!,
          line: forward.line,
          isAbstract: false,
          isExternal: true,
          attributes: [],
          methods: [],
        });
      }
    }
  }

  // ---- Step 2: edges ----

  private addDeclarationEdges(id: string, located: LocatedDeclaration): void {
    const { declaration, fileSymbols } = located;
    const scope = declaration.scope;
    const usingNamespaces = fileSymbols.usingNamespaces;
    // Each edge remembers the line that creates it, which the diagram opens (spec §4.6).
    const file = this.fileIndexByPath.get(fileSymbols.file)!;

    for (const base of declaration.bases) {
      const baseId = this.resolveClass(base.type.name, scope, usingNamespaces);
      if (baseId !== undefined) {
        this.edges.add(id, baseId, 'inherit', { file, line: base.line }, { access: base.access });
      }
    }
    for (const attribute of declaration.attributes) {
      const attributeDeclaration = { file, line: attribute.line, member: attribute.name };
      for (const relation of this.classifier.classify(attribute.type, scope, usingNamespaces)) {
        this.edges.add(id, relation.targetId, relation.kind, attributeDeclaration, { multiplicity: relation.multiplicity });
      }
    }
    for (const method of declaration.methods) {
      this.addDependencies(id, method.name, { file, line: method.line }, method.signatureTypes, method.bodyReferences, scope, usingNamespaces);
      if (method.calls.length > 0) {
        this.methodCodes.push({ classId: id, methodName: method.name, file, calls: method.calls, scope, usingNamespaces });
      }
    }
    for (const friend of declaration.friends) {
      const friendId = this.resolveClass(friend.name, scope, usingNamespaces);
      if (friendId !== undefined) {
        this.edges.add(id, friendId, 'friend', { file, line: friend.line });
      }
    }
    if (declaration.outerClass !== undefined && this.nodesById.has(declaration.outerClass)) {
      this.edges.add(declaration.outerClass, id, 'nest', { file, line: declaration.line });
    }
  }

  /** A method defined outside its class: records where, and adds the dependencies of its code. */
  private addOutOfClassMethod(method: OutOfClassMethod, fileSymbols: FileSymbols): void {
    const ownerId = this.resolveClass(method.ownerName, method.scope, fileSymbols.usingNamespaces);
    if (ownerId === undefined) {
      // The name before `::` is a namespace, or a class outside the scanned files: for the
      // classes of the diagram, this code is a free function.
      this.addFreeFunction(method, `${method.ownerName}::${method.name}`, fileSymbols);
      return;
    }
    addToSetMap(this.classIdsByFile, fileSymbols.file, ownerId);
    const owner = this.nodesById.get(ownerId)!;
    const fileIndex = this.fileIndexByPath.get(fileSymbols.file)!;
    (owner.sourceRanges ??= []).push({ file: fileIndex, ...method.sourceRange });
    if (fileIndex !== owner.file) {
      addUniqueNumber((owner.definitionFiles ??= []), fileIndex);
      const definitionLines = this.definitionLinesById.get(ownerId) ?? new Map<number, number>();
      definitionLines.set(fileIndex, Math.min(method.line, definitionLines.get(fileIndex) ?? method.line));
      this.definitionLinesById.set(ownerId, definitionLines);
    }
    // Inside `Engine::run`, names are looked up in the scope of class Engine first.
    const ownerScope = this.scopeOfClass(ownerId, method.scope.templateParameters);
    const methodLocation = { file: fileIndex, line: method.line };
    this.methodDefinitions.addDefinition(ownerId, method.name, method.signatureTypes, methodLocation);
    const usingNamespaces = fileSymbols.usingNamespaces;
    this.addDependencies(ownerId, method.name, methodLocation, method.signatureTypes, method.bodyReferences, ownerScope, usingNamespaces);
    if (method.calls.length > 0) {
      this.methodCodes.push({ classId: ownerId, methodName: method.name, file: fileIndex, calls: method.calls, scope: ownerScope, usingNamespaces });
    }
  }

  /**
   * A function that belongs to no class (spec §3.2): the classes that it names in its signature
   * or in its code are dependencies, each kept once with its first line, and its calls are
   * resolved with those of the methods.
   */
  private addFreeFunction(code: FreeFunction, name: string, fileSymbols: FileSymbols): void {
    const namespaces = code.scope.namespacePath.filter((part) => part !== ANONYMOUS_NAMESPACE);
    const functionName = [...namespaces, name].join('::');
    const file = this.fileIndexByPath.get(fileSymbols.file)!;
    const usingNamespaces = fileSymbols.usingNamespaces;
    const signatureReferences = code.signatureTypes.flatMap(collectTypeNames).map((typeName) => ({ name: typeName, line: code.line }));
    const knownClassIds = new Set<string>();
    for (const reference of [...signatureReferences, ...code.bodyReferences]) {
      for (const targetId of this.resolveDependencyTargets(reference.name, code.scope, usingNamespaces)) {
        if (!knownClassIds.has(targetId)) {
          knownClassIds.add(targetId);
          this.functionDependencies.push({ functionName, to: targetId, kind: 'depend', file, line: reference.line });
        }
      }
    }
    if (code.calls.length > 0) {
      this.functionCodes.push({ functionName, file, calls: code.calls, scope: code.scope, usingNamespaces, knownClassIds: Array.from(knownClassIds) });
    }
  }

  /**
   * The dependencies of one method. A type of its parameters or of its return value is declared
   * on the line of the method; a type used in its code is declared on the line that uses it.
   */
  private addDependencies(
    fromId: string,
    methodName: string,
    methodLocation: SourceLocation,
    signatureTypes: TypeExpression[],
    bodyReferences: BodyTypeReference[],
    scope: LookupScope,
    usingNamespaces: string[],
  ): void {
    const signatureReferences = signatureTypes.flatMap(collectTypeNames).map((name) => ({ name, line: methodLocation.line }));
    for (const reference of [...signatureReferences, ...bodyReferences]) {
      for (const targetId of this.resolveDependencyTargets(reference.name, scope, usingNamespaces)) {
        this.edges.add(fromId, targetId, 'depend', { file: methodLocation.file, line: reference.line, member: methodName });
      }
    }
  }

  /** A dependency on an alias such as `using ItemList = std::vector<Item>` is a dependency on `Item`. */
  private resolveDependencyTargets(name: string, scope: LookupScope, usingNamespaces: string[]): string[] {
    const resolution = this.resolver.resolve(name, scope, usingNamespaces);
    if (resolution.kind === 'class') {
      return [resolution.id];
    }
    if (resolution.kind === 'unresolved') {
      this.countUnresolved(name);
      return [];
    }
    if (resolution.kind === 'alias') {
      const alias = resolution.alias;
      const targets: string[] = [];
      for (const aliasedName of collectTypeNames(alias.type)) {
        const aliasedResolution = this.resolver.resolve(aliasedName, alias.scope, usingNamespaces);
        if (aliasedResolution.kind === 'class') {
          targets.push(aliasedResolution.id);
        }
      }
      return targets;
    }
    return [];
  }

  private addIncludeEdges(): void {
    const includeResolver = new IncludeResolver(this.fileSymbolsList.map((symbols) => symbols.file));
    for (const fileSymbols of this.fileSymbolsList) {
      const sourceId = this.mainClassOfFile(fileSymbols.file, this.classIdsByFile.get(fileSymbols.file));
      if (sourceId === undefined) {
        continue;
      }
      const file = this.fileIndexByPath.get(fileSymbols.file)!;
      for (const include of fileSymbols.includes) {
        const includedFile = includeResolver.resolve(fileSymbols.file, include.path);
        if (includedFile === undefined) {
          continue;
        }
        const targetId = this.mainClassOfFile(includedFile, this.declaredClassIdsByFile.get(includedFile));
        if (targetId !== undefined) {
          this.edges.add(sourceId, targetId, 'include', { file, line: include.line });
        }
      }
    }
  }

  /**
   * The class that stands for a file in include relations (spec §3). An include is a relation
   * between two files: drawing it between every class of one file and every class of the
   * other would add many edges that say nothing more. The main class is the one named like
   * the file (`scene.h` and `Scene`), otherwise the first class that is not nested in another.
   */
  private mainClassOfFile(file: string, classIds: Set<string> | undefined): string | undefined {
    if (classIds === undefined || classIds.size === 0) {
      return undefined;
    }
    const ids = Array.from(classIds);
    const baseName = file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
    const normalize = (name: string) => name.toLowerCase().replace(/_/g, '');
    const namedLikeFile = ids.find((id) => normalize(this.nodesById.get(id)!.name) === normalize(baseName));
    if (namedLikeFile !== undefined) {
      return namedLikeFile;
    }
    const isNested = (id: string) => {
      const node = this.nodesById.get(id)!;
      const nameInNamespace = node.namespace === '' ? id : id.slice(node.namespace.length + 2);
      return nameInNamespace.includes('::');
    };
    return ids.find((id) => !isNested(id)) ?? ids[0];
  }

  // ---- Step 3: implementation files ----

  private findImplementations(): void {
    const finder = new ImplementationFinder(this.fileSymbolsList.map((symbols) => symbols.file));
    for (const node of this.nodesById.values()) {
      // A class that is only forward-declared has no file of its own.
      if (node.isExternal) {
        continue;
      }
      const implementation = finder.find(node.file, this.definitionLinesById.get(node.id) ?? new Map<number, number>());
      if (implementation !== undefined) {
        node.implementation = implementation;
      }
    }
  }

  // ---- Step 4: method calls ----

  /**
   * The types of the attributes of each class and the signatures of its methods, as each of
   * its declarations writes them: a call on an attribute, or on what a method returns, goes
   * to the class of that type.
   */
  private declaredMemberTypes(): Map<string, DeclaredMemberTypes[]> {
    const typesByClass = new Map<string, DeclaredMemberTypes[]>();
    for (const [id, declarations] of this.declarationsById) {
      const declaredTypes = declarations.map(({ declaration, fileSymbols }) => {
        const methods = new Map<string, CallableSignature[]>();
        for (const method of declaration.methods) {
          const signature = { parameters: method.parameters, returnType: method.returnType };
          methods.set(method.name, [...(methods.get(method.name) ?? []), signature]);
        }
        const attributeTypes = new Map(declaration.attributes.map((attribute) => [attribute.name, attribute.type]));
        return { scope: declaration.scope, usingNamespaces: fileSymbols.usingNamespaces, attributeTypes, methods };
      });
      typesByClass.set(id, declaredTypes);
    }
    return typesByClass;
  }

  /** The free functions, from their definitions and from their prototypes: what a call of one of them returns. */
  private declaredFunctions(): DeclaredFunction[] {
    const functions: DeclaredFunction[] = [];
    for (const fileSymbols of this.fileSymbolsList) {
      const usingNamespaces = fileSymbols.usingNamespaces;
      for (const declared of [...fileSymbols.freeFunctions, ...fileSymbols.functionPrototypes]) {
        const signature = { parameters: declared.parameters, returnType: declared.returnType };
        functions.push({ name: declared.name, scope: declared.scope, usingNamespaces, signature });
      }
    }
    return functions;
  }

  // ---- Helpers ----

  private resolveClass(name: string, scope: LookupScope, usingNamespaces: string[]): string | undefined {
    const resolution = this.resolver.resolve(name, scope, usingNamespaces);
    if (resolution.kind === 'class') {
      return resolution.id;
    }
    if (resolution.kind === 'alias') {
      // `typedef Base<int> IntBase; class Foo : public IntBase {}`: follow the alias once.
      const aliased = this.resolver.resolve(resolution.alias.type.name, resolution.alias.scope, usingNamespaces);
      return aliased.kind === 'class' ? aliased.id : undefined;
    }
    if (resolution.kind === 'unresolved') {
      this.countUnresolved(name);
    }
    return undefined;
  }

  /** The lookup scope of the members of a class, rebuilt from its qualified name. */
  private scopeOfClass(classId: string, templateParameters: string[]): LookupScope {
    const node = this.nodesById.get(classId)!;
    const namespacePath = node.namespace === '' ? [] : node.namespace.split('::');
    const classPath = classId.split('::').slice(namespacePath.length);
    return { namespacePath, classPath, templateParameters };
  }

  private countUnresolved(name: string): void {
    this.unresolvedTypeNames.set(name, (this.unresolvedTypeNames.get(name) ?? 0) + 1);
  }
}

/** The name that the parser gives to a namespace without a name. */
const ANONYMOUS_NAMESPACE = '(anonymous)';

function memberKey(member: Member): string {
  return `${member.name}|${member.signature}`;
}

/** Returns whether the member was added. */
function addIfUnknown(members: Member[], member: Member, known: Set<string>): boolean {
  const key = memberKey(member);
  if (known.has(key)) {
    return false;
  }
  known.add(key);
  members.push(member);
  return true;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function addUniqueNumber(values: number[], value: number): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}
