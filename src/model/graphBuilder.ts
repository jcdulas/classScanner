// Builds the class graph from the symbols of every parsed file (spec §2.5, §2.6, §3).
//
// The steps are:
//   1. merge the declarations of each class: a class can be declared in
//      several `#if` branches, and its methods can be defined in .cpp files;
//   2. create "external" nodes for classes that are only forward-declared;
//   3. resolve every type name and create the edges of the seven relation kinds.

import { LookupScope, TypeDeclaration, FileSymbols, TypeExpression } from '../parser/fileSymbols';
import { collectTypeNames } from '../parser/typeReader';
import { ClassNode, Graph, Member, MemberFlags } from '../shared/graphModel';
import { EdgeCollector } from './edgeCollector';
import { IncludeResolver } from './includeResolver';
import { MemberRelationClassifier } from './memberRelations';
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
  private readonly edges = new EdgeCollector();
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
        this.addOutOfClassMethodEdges(method.ownerName, method.scope, method.signatureTypes, method.bodyTypeNames, fileSymbols);
      }
    }
    this.addIncludeEdges();
    for (const name of this.classifier.unresolvedNames) {
      this.countUnresolved(name);
    }

    const graph: Graph = {
      root: this.root,
      nodes: Array.from(this.nodesById.values()),
      edges: this.edges.toEdges(),
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
      addIfUnknown(node.methods, member, known);
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

    for (const base of declaration.bases) {
      const baseId = this.resolveClass(base.type.name, scope, usingNamespaces);
      if (baseId !== undefined) {
        this.edges.add(id, baseId, 'inherit', { access: base.access });
      }
    }
    for (const attribute of declaration.attributes) {
      for (const relation of this.classifier.classify(attribute.type, scope, usingNamespaces)) {
        this.edges.add(id, relation.targetId, relation.kind, { multiplicity: relation.multiplicity });
      }
    }
    for (const method of declaration.methods) {
      this.addDependencies(id, method.signatureTypes, method.bodyTypeNames, scope, usingNamespaces);
    }
    for (const friendName of declaration.friends) {
      const friendId = this.resolveClass(friendName, scope, usingNamespaces);
      if (friendId !== undefined) {
        this.edges.add(id, friendId, 'friend');
      }
    }
    if (declaration.outerClass !== undefined && this.nodesById.has(declaration.outerClass)) {
      this.edges.add(declaration.outerClass, id, 'nest');
    }
  }

  private addOutOfClassMethodEdges(
    ownerName: string,
    definitionScope: LookupScope,
    signatureTypes: TypeExpression[],
    bodyTypeNames: string[],
    fileSymbols: FileSymbols,
  ): void {
    const ownerId = this.resolveClass(ownerName, definitionScope, fileSymbols.usingNamespaces);
    if (ownerId === undefined) {
      return;
    }
    addToSetMap(this.classIdsByFile, fileSymbols.file, ownerId);
    // Inside `Engine::run`, names are looked up in the scope of class Engine first.
    const ownerScope = this.scopeOfClass(ownerId, definitionScope.templateParameters);
    this.addDependencies(ownerId, signatureTypes, bodyTypeNames, ownerScope, fileSymbols.usingNamespaces);
  }

  private addDependencies(
    fromId: string,
    signatureTypes: TypeExpression[],
    bodyTypeNames: string[],
    scope: LookupScope,
    usingNamespaces: string[],
  ): void {
    const names = [...signatureTypes.flatMap(collectTypeNames), ...bodyTypeNames];
    for (const name of names) {
      for (const targetId of this.resolveDependencyTargets(name, scope, usingNamespaces)) {
        this.edges.add(fromId, targetId, 'depend');
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
      const sourceIds = this.classIdsByFile.get(fileSymbols.file);
      if (sourceIds === undefined) {
        continue;
      }
      for (const include of fileSymbols.includes) {
        const includedFile = includeResolver.resolve(fileSymbols.file, include.path);
        const targetIds = includedFile === undefined ? undefined : this.declaredClassIdsByFile.get(includedFile);
        if (targetIds === undefined) {
          continue;
        }
        for (const sourceId of sourceIds) {
          for (const targetId of targetIds) {
            this.edges.add(sourceId, targetId, 'include');
          }
        }
      }
    }
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

function memberKey(member: Member): string {
  return `${member.name}|${member.signature}`;
}

function addIfUnknown(members: Member[], member: Member, known: Set<string>): void {
  const key = memberKey(member);
  if (!known.has(key)) {
    known.add(key);
    members.push(member);
  }
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}
