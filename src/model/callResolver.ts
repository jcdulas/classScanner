// Finds which class each method call goes to (spec §3.1).
//
// Without a compiler, the class of the object of a call is not always known.
// The rules below give an answer only when the source names the class, and
// drop the call otherwise: a call that is listed is right most of the time,
// but calls are missed.
//
//   - `scene->add()`, where `scene` is a parameter, a local variable or an
//     attribute whose type names a project class: the call goes to that class.
//     Types are searched through their template arguments, so a
//     `std::unique_ptr<Scene>` is a `Scene`.
//   - `Registry::instance()`: the call goes to the class named before `::`.
//   - `update()` and `this->update()`, when the class does not declare
//     `update` itself: the call goes to the base class that provides it.
//   - any other object (`factory().create()`, a variable declared with
//     `auto`): the call is kept when exactly one of the classes that the
//     caller has a relation to has a method of that name.
//
// In every case the class must have a method of that name, declared by itself
// or by one of its base classes. A class that is only forward-declared in the
// scan has no known method: it is trusted when the source names it.

import { CallReference, LookupScope, TypeExpression } from '../parser/fileSymbols';
import { collectTypeNames } from '../parser/typeReader';
import { ClassNode, Edge, MethodCall, RelationKind } from '../shared/graphModel';
import { TypeResolver } from './typeResolver';

/** The calls made by one method, with what is needed to resolve them. */
export interface MethodCode {
  classId: string;
  methodName: string;
  /** Index in Graph.files of the file that contains the code. */
  file: number;
  calls: CallReference[];
  /** Scope in which the names of the code are looked up. */
  scope: LookupScope;
  usingNamespaces: string[];
}

/** Relations that tell that a class can hold or receive an object of another class. */
const RELATIONS_TO_KNOWN_CLASSES: RelationKind[] = ['inherit', 'compose', 'aggregate', 'depend'];

export class CallResolver {
  private readonly methodNamesByClass = new Map<string, Set<string>>();
  private readonly basesByClass = new Map<string, string[]>();
  private readonly knownClassesByClass = new Map<string, Set<string>>();

  /**
   * `attributeTypesByClass` gives, for each class, the type of its attributes by name.
   * `edges` are the relations of the graph: they tell the bases of a class and the classes it knows.
   */
  constructor(
    private readonly nodesById: Map<string, ClassNode>,
    private readonly resolver: TypeResolver,
    private readonly attributeTypesByClass: Map<string, Map<string, TypeExpression>>,
    edges: Edge[],
  ) {
    for (const node of nodesById.values()) {
      this.methodNamesByClass.set(node.id, new Set(node.methods.map((method) => method.name)));
    }
    for (const edge of edges) {
      if (edge.kind === 'inherit') {
        addToListMap(this.basesByClass, edge.from, edge.to);
      }
      if (RELATIONS_TO_KNOWN_CLASSES.includes(edge.kind)) {
        const known = this.knownClassesByClass.get(edge.from) ?? new Set<string>();
        known.add(edge.to);
        this.knownClassesByClass.set(edge.from, known);
      }
    }
  }

  /** The calls from a class to another one, each kept once per calling method, with its first line. */
  resolve(methods: MethodCode[]): MethodCall[] {
    const callsByKey = new Map<string, MethodCall>();
    for (const method of methods) {
      for (const call of method.calls) {
        for (const targetId of this.targetClassesOf(call, method)) {
          if (targetId === method.classId) {
            continue; // A call inside the class says nothing about its relations to other classes.
          }
          const key = `${method.classId}|${method.methodName}|${targetId}|${call.name}`;
          if (!callsByKey.has(key)) {
            callsByKey.set(key, {
              from: method.classId,
              fromMethod: method.methodName,
              to: targetId,
              method: call.name,
              file: method.file,
              line: call.line,
            });
          }
        }
      }
    }
    return Array.from(callsByKey.values());
  }

  private targetClassesOf(call: CallReference, method: MethodCode): string[] {
    switch (call.receiverKind) {
      case 'own':
        return this.baseProviding(method.classId, call.name);
      case 'scope': {
        const classIds = this.classesNamed(call.receiverName ?? '', method);
        return classIds.filter((id) => this.canCall(id, call.name));
      }
      case 'variable': {
        const type = call.receiverType ?? this.attributeTypesByClass.get(method.classId)?.get(call.receiverName ?? '');
        if (type === undefined) {
          return this.onlyKnownClassWith(method.classId, call.name);
        }
        const classIds = collectTypeNames(type).flatMap((name) => this.classesNamed(name, method));
        return classIds.filter((id) => this.canCall(id, call.name));
      }
      case 'expression':
        return this.onlyKnownClassWith(method.classId, call.name);
    }
  }

  /** The direct base class through which `classId` gets a method it does not declare itself. */
  private baseProviding(classId: string, methodName: string): string[] {
    if (this.methodNamesByClass.get(classId)?.has(methodName)) {
      return [];
    }
    const base = (this.basesByClass.get(classId) ?? []).find((baseId) => this.hasMethod(baseId, methodName, new Set()));
    return base === undefined ? [] : [base];
  }

  /** When the class of the object is not written: the single known class that has the method, if any. */
  private onlyKnownClassWith(classId: string, methodName: string): string[] {
    const candidates = [classId, ...(this.knownClassesByClass.get(classId) ?? [])];
    const withMethod = candidates.filter((id) => this.hasMethod(id, methodName, new Set()));
    return withMethod.length === 1 ? withMethod : [];
  }

  /** The project classes that a name of the source refers to; an alias is followed once (spec §2.6). */
  private classesNamed(name: string, method: MethodCode): string[] {
    const resolution = this.resolver.resolve(name, method.scope, method.usingNamespaces);
    if (resolution.kind === 'class') {
      return [resolution.id];
    }
    if (resolution.kind !== 'alias') {
      return [];
    }
    const alias = resolution.alias;
    const classIds: string[] = [];
    for (const aliasedName of collectTypeNames(alias.type)) {
      const aliased = this.resolver.resolve(aliasedName, alias.scope, method.usingNamespaces);
      if (aliased.kind === 'class') {
        classIds.push(aliased.id);
      }
    }
    return classIds;
  }

  /** True when a call of `methodName` on an object of the class is believable. */
  private canCall(classId: string, methodName: string): boolean {
    const node = this.nodesById.get(classId);
    // The methods of a class that is only forward-declared are not known.
    return node !== undefined && (node.isExternal || this.hasMethod(classId, methodName, new Set()));
  }

  /** True when the class or one of its base classes declares a method of that name. */
  private hasMethod(classId: string, methodName: string, visited: Set<string>): boolean {
    if (visited.has(classId)) {
      return false; // Protects against a cycle of base classes in broken code.
    }
    visited.add(classId);
    if (this.methodNamesByClass.get(classId)?.has(methodName)) {
      return true;
    }
    return (this.basesByClass.get(classId) ?? []).some((baseId) => this.hasMethod(baseId, methodName, visited));
  }
}

function addToListMap(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
