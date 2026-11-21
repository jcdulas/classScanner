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
//   - any other object, such as `factory().create()` or a variable declared
//     with `auto`: the type of the expression is worked out from the declared
//     types of what it is made of (see "The type of an expression" below).
//     When a method has overloads, the arguments of the call choose among
//     them (overloads.ts).
//     When nothing is known of it, the call is kept only if exactly one of the
//     classes that the caller has a relation to has a method of that name.
//
// In every case the class must have a method of that name, declared by itself
// or by one of its base classes. A class that is only forward-declared in the
// scan has no known method: it is trusted when the source names it.
//
// The calls made by free functions (spec §3.2) follow the same rules, without
// the ones that need a class: a function has no attribute and no base class.

import { CallReference, LookupScope, ParameterList, TypeExpression, ValueExpression } from '../parser/fileSymbols';
import { collectTypeNames } from '../parser/typeReader';
import { ClassNode, Edge, FunctionUse, MethodCall, RelationKind } from '../shared/graphModel';
import { OverloadParameters, ValueCategory, categoryOfLiteral, categoryOfTypeName, chooseOverloads } from './overloads';
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

/** The calls made by one free function, with what is needed to resolve them. */
export interface FunctionCode {
  /** Qualified name of the function, for example `app::main`. */
  functionName: string;
  file: number;
  calls: CallReference[];
  scope: LookupScope;
  usingNamespaces: string[];
  /** The classes that the function names in its signature or in its code. */
  knownClassIds: string[];
}

/**
 * The types that one declaration of a class gives to its members, as written in the source.
 * Their names are resolved in the scope of the declaration, not in the scope of the code that
 * uses the members.
 */
export interface DeclaredMemberTypes {
  scope: LookupScope;
  usingNamespaces: string[];
  /** The type of each attribute, by name. */
  attributeTypes: Map<string, TypeExpression>;
  /** The methods, by name: several for a method with overloads. */
  methods: Map<string, CallableSignature[]>;
}

/** What tells the overloads of a method or of a function apart, and what each one returns. */
export interface CallableSignature {
  parameters: ParameterList;
  /** Undefined for a constructor or a destructor. */
  returnType?: TypeExpression;
}

/** A free function, from its definition or from its prototype. */
export interface DeclaredFunction {
  name: string;
  scope: LookupScope;
  usingNamespaces: string[];
  signature: CallableSignature;
}

/** An overload with its types worked out: the categories of its parameters, and the classes that its return type names. */
interface ResolvedOverload extends OverloadParameters {
  returnCategory: ValueCategory;
}

/** What the rules need to know about the code that makes a call. */
interface Caller {
  /** The class of the method, or undefined for a free function. */
  classId: string | undefined;
  /** The classes whose objects the code can hold or receive. */
  knownClassIds: string[];
  scope: LookupScope;
  usingNamespaces: string[];
}

/** Relations that tell that a class can hold or receive an object of another class. */
const RELATIONS_TO_KNOWN_CLASSES: RelationKind[] = ['inherit', 'compose', 'aggregate', 'depend'];

/** An expression nested deeper than this is not followed. */
const MAX_VALUE_DEPTH = 12;

export class CallResolver {
  private readonly methodNamesByClass = new Map<string, Set<string>>();
  private readonly basesByClass = new Map<string, string[]>();
  private readonly knownClassesByClass = new Map<string, Set<string>>();
  private readonly functionsByName = new Map<string, DeclaredFunction[]>();
  /** Answers already worked out, by `class|member`: the same members are asked about many times. */
  private readonly overloadsCache = new Map<string, ResolvedOverload[]>();
  private readonly functionOverloadsCache = new Map<string, ResolvedOverload[]>();
  private readonly attributeTypesCache = new Map<string, ValueCategory | undefined>();

  /**
   * `declaredTypesByClass` gives, for each class, the types of its attributes and the
   * signatures of its methods. `edges` are the relations of the graph: they tell the bases of a
   * class and the classes it knows.
   */
  constructor(
    private readonly nodesById: Map<string, ClassNode>,
    private readonly resolver: TypeResolver,
    private readonly declaredTypesByClass: Map<string, DeclaredMemberTypes[]>,
    functions: DeclaredFunction[],
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
    for (const declaredFunction of functions) {
      addToListMap(this.functionsByName, declaredFunction.name, declaredFunction);
    }
  }

  /** The calls from a class to another one, each kept once per calling method, with its first line. */
  resolve(methods: MethodCode[]): MethodCall[] {
    const callsByKey = new Map<string, MethodCall>();
    for (const method of methods) {
      const caller: Caller = {
        classId: method.classId,
        knownClassIds: Array.from(this.knownClassesByClass.get(method.classId) ?? []),
        scope: method.scope,
        usingNamespaces: method.usingNamespaces,
      };
      for (const call of method.calls) {
        for (const targetId of this.targetClassesOf(call, caller)) {
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

  /** The calls from free functions to classes, each kept once per function and file, with its first line. */
  resolveFunctionCalls(functions: FunctionCode[]): FunctionUse[] {
    const usesByKey = new Map<string, FunctionUse>();
    for (const code of functions) {
      const caller: Caller = { classId: undefined, knownClassIds: code.knownClassIds, scope: code.scope, usingNamespaces: code.usingNamespaces };
      for (const call of code.calls) {
        for (const targetId of this.targetClassesOf(call, caller)) {
          const key = `${code.functionName}|${code.file}|${targetId}|${call.name}`;
          if (!usesByKey.has(key)) {
            usesByKey.set(key, { functionName: code.functionName, to: targetId, kind: 'call', method: call.name, file: code.file, line: call.line });
          }
        }
      }
    }
    return Array.from(usesByKey.values());
  }

  private targetClassesOf(call: CallReference, caller: Caller): string[] {
    const canBeCalledOn = (classId: string) => this.canCall(classId, call.name);
    switch (call.receiverKind) {
      case 'own':
        // In a free function, a plain call is a call of another free function.
        return caller.classId === undefined ? [] : this.baseProviding(caller.classId, call.name);
      case 'scope':
        return this.classesNamed(call.receiverName ?? '', caller.scope, caller.usingNamespaces).filter(canBeCalledOn);
      case 'variable': {
        const category =
          call.receiverType !== undefined
            ? this.categoryOfType(call.receiverType, caller.scope, caller.usingNamespaces)
            : this.attributeTypeOf(caller.classId, call.receiverName ?? '');
        // Undefined: the name is no attribute of the class, so nothing is known of the object.
        return category === undefined ? this.onlyKnownClassWith(caller, call.name) : classIdsOf(category).filter(canBeCalledOn);
      }
      case 'expression': {
        const classIds = call.receiverValue === undefined ? [] : classIdsOf(this.categoryOfValue(call.receiverValue, caller, 0));
        // When the type of the expression is known, it is trusted even if it has no such method.
        return classIds.length === 0 ? this.onlyKnownClassWith(caller, call.name) : classIds.filter(canBeCalledOn);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The type of an expression
  // ---------------------------------------------------------------------------
  //
  // An expression is followed from the inside out: `pool.nextJob()` is what the
  // method `nextJob` of the class of `pool` returns. The answer is the list of
  // the project classes that the type names, like for a declared type: a
  // `std::vector<Job*>` names `Job`, which is right both for the container and
  // for its elements, since the method that is called then tells them apart.
  //
  // When a method has overloads, the arguments of the call choose among them
  // (overloads.ts); the overloads that the arguments do not tell apart are all
  // taken.
  //
  // What is not done, and that a compiler does: working out template arguments,
  // expanding macros, following lambdas and function pointers, and applying
  // overloaded operators.

  /** The value's type is used for both overload ranking and finding the receiver of a method. */
  private categoryOfValue(value: ValueExpression, caller: Caller, depth: number): ValueCategory {
    if (depth > MAX_VALUE_DEPTH) {
      return { kind: 'unknown' };
    }
    switch (value.kind) {
      case 'this':
        return caller.classId === undefined ? { kind: 'unknown' } : { kind: 'classes', classIds: [caller.classId], isPointer: true };
      case 'attribute':
        return this.attributeTypeOf(caller.classId, value.name) ?? { kind: 'unknown' };
      case 'typed':
        return this.categoryOfType(value.type, caller.scope, caller.usingNamespaces);
      case 'address':
      case 'dereference': {
        const operand = this.categoryOfValue(value.operand, caller, depth + 1);
        if (operand.kind === 'classes') {
          // A raw pointer yields an object. A container's element indirection can be unknown.
          const isPointer = value.kind === 'address' ? true : operand.isPointer ? false : undefined;
          return { ...operand, isPointer };
        }
        if (value.kind === 'address') return { kind: operand.kind === 'character' ? 'characterPointer' : 'pointer' };
        return { kind: operand.kind === 'characterPointer' ? 'character' : 'unknown' };
      }
      case 'call': {
        // Worked out only if the method turns out to have overloads.
        const argumentCategories = () => value.arguments.map((argument) => this.categoryOfValue(argument, caller, depth + 1));
        return this.categoryOfCallResult(value.name, argumentCategories, value.receiver, value.scopeName, caller, depth);
      }
      case 'member': {
        const ownerIds = classIdsOf(this.categoryOfValue(value.receiver, caller, depth + 1));
        const attributes = ownerIds.map((id) => this.attributeTypeOf(id, value.name)).filter((type) => type !== undefined);
        // No such attribute, as for `iterator->second`: the member of a wrapper or of a
        // container, which holds objects of the same classes.
        return attributes.length > 0 ? mergeCategories(attributes) : containerElementType(ownerIds);
      }
      case 'literal':
        return categoryOfLiteral(value.literal);
      case 'unknown':
        return { kind: 'unknown' };
    }
  }

  /** What is known of a declared type: the project classes that it names, or else a type of the language. */
  private categoryOfType(type: TypeExpression, scope: LookupScope, usingNamespaces: string[]): ValueCategory {
    const resolved = this.resolver.resolve(type.name, scope, usingNamespaces);
    const isPointer = type.indirection === 'pointer' || type.isArray || (resolved.kind === 'alias' && resolved.alias.type.indirection === 'pointer');
    const classIds = this.classesInType(type, scope, usingNamespaces);
    return classIds.length === 0 ? categoryOfTypeName(type.name, isPointer) : { kind: 'classes', classIds, isPointer };
  }

  /** The classes named by what a call returns. `argumentCategories` gives its arguments, when they are needed. */
  private categoryOfCallResult(
    name: string,
    argumentCategories: () => ValueCategory[],
    receiver: ValueExpression | undefined,
    scopeName: string | undefined,
    caller: Caller,
    depth: number,
  ): ValueCategory {
    const returnedBy = (ownerIds: string[]) => mergeCategories(ownerIds.map((id) => this.returnTypeOfOverloads(this.overloadsOf(id, name), argumentCategories)));
    if (receiver !== undefined) {
      const ownerIds = classIdsOf(this.categoryOfValue(receiver, caller, depth + 1));
      const providerIds = ownerIds.filter((ownerId) => this.hasMethod(ownerId, name, new Set()));
      // None of the classes has such a method, as for `pointer.get()` or `list.front()`: a
      // method of a wrapper or of a container, which gives back objects of the same classes.
      return providerIds.length === 0 ? containerElementType(ownerIds) : returnedBy(providerIds);
    }
    // `Job(...)` and `tools::Job(...)` build an object of the class.
    const builtClassIds = this.classesNamed(scopeName === undefined ? name : `${scopeName}::${name}`, caller.scope, caller.usingNamespaces);
    if (builtClassIds.length > 0) {
      return { kind: 'classes', classIds: builtClassIds, isPointer: false };
    }
    if (scopeName !== undefined) {
      // `Registry::instance()`: a method of the class named before `::`. Otherwise the scope is
      // a namespace, and the call is the one of a free function.
      const ownerIds = this.classesNamed(scopeName, caller.scope, caller.usingNamespaces);
      return ownerIds.length > 0 ? returnedBy(ownerIds) : this.returnTypeOfOverloads(this.functionOverloads(name), argumentCategories);
    }
    if (caller.classId !== undefined && this.hasMethod(caller.classId, name, new Set())) {
      return returnedBy([caller.classId]);
    }
    return this.returnTypeOfOverloads(this.functionOverloads(name), argumentCategories);
  }

  private returnTypeOfOverloads(overloads: ResolvedOverload[], argumentCategories: () => ValueCategory[]): ValueCategory {
    const chosen = overloads.length <= 1 ? overloads : chooseOverloads(overloads, argumentCategories(), (classId, baseId) => this.isDerivedFrom(classId, baseId, new Set()));
    return mergeCategories(chosen.map((overload) => overload.returnCategory));
  }

  /** The overloads of a method of a class; the method can be declared by a base class. */
  private overloadsOf(classId: string, methodName: string): ResolvedOverload[] {
    const key = `${classId}|${methodName}`;
    let overloads = this.overloadsCache.get(key);
    if (overloads === undefined) {
      // An empty answer is stored first: it stops a cycle of base classes in broken code.
      this.overloadsCache.set(key, []);
      if (this.methodNamesByClass.get(classId)?.has(methodName) === true) {
        // As in the language, a class that declares a method of that name hides those of its base classes.
        overloads = (this.declaredTypesByClass.get(classId) ?? []).flatMap((declared) =>
          (declared.methods.get(methodName) ?? []).map((signature) => this.resolveOverload(signature, declared.scope, declared.usingNamespaces)),
        );
      } else {
        overloads = (this.basesByClass.get(classId) ?? []).flatMap((baseId) => this.overloadsOf(baseId, methodName));
      }
      this.overloadsCache.set(key, overloads);
    }
    return overloads;
  }

  /** The free functions of that name, whatever their namespace. */
  private functionOverloads(functionName: string): ResolvedOverload[] {
    let overloads = this.functionOverloadsCache.get(functionName);
    if (overloads === undefined) {
      const declaredFunctions = this.functionsByName.get(functionName) ?? [];
      overloads = declaredFunctions.map((declared) => this.resolveOverload(declared.signature, declared.scope, declared.usingNamespaces));
      this.functionOverloadsCache.set(functionName, overloads);
    }
    return overloads;
  }

  private resolveOverload(signature: CallableSignature, scope: LookupScope, usingNamespaces: string[]): ResolvedOverload {
    return {
      categories: signature.parameters.types.map((type) => this.categoryOfType(type, scope, usingNamespaces)),
      requiredCount: signature.parameters.requiredCount,
      isVariadic: signature.parameters.isVariadic,
      returnCategory: signature.returnType === undefined ? { kind: 'unknown' } : this.categoryOfType(signature.returnType, scope, usingNamespaces),
    };
  }

  /**
   * The classes named by the type of an attribute of a class, which a base class can declare.
   * Undefined when neither the class nor its base classes have an attribute of that name.
   */
  private attributeTypeOf(classId: string | undefined, attributeName: string): ValueCategory | undefined {
    if (classId === undefined) {
      return undefined;
    }
    const key = `${classId}|${attributeName}`;
    if (this.attributeTypesCache.has(key)) {
      return this.attributeTypesCache.get(key);
    }
    // "No such attribute" is stored first: it stops a cycle of base classes in broken code.
    this.attributeTypesCache.set(key, undefined);
    const types: ValueCategory[] = [];
    for (const declared of this.declaredTypesByClass.get(classId) ?? []) {
      const type = declared.attributeTypes.get(attributeName);
      if (type !== undefined) {
        types.push(this.categoryOfType(type, declared.scope, declared.usingNamespaces));
      }
    }
    let category = types.length ? mergeCategories(types) : undefined;
    if (category === undefined) {
      for (const baseId of this.basesByClass.get(classId) ?? []) {
        category = this.attributeTypeOf(baseId, attributeName);
        if (category !== undefined) {
          break;
        }
      }
    }
    this.attributeTypesCache.set(key, category);
    return category;
  }

  // ---------------------------------------------------------------------------
  // Names, methods and base classes
  // ---------------------------------------------------------------------------

  /** The direct base class through which `classId` gets a method it does not declare itself. */
  private baseProviding(classId: string, methodName: string): string[] {
    if (this.methodNamesByClass.get(classId)?.has(methodName)) {
      return [];
    }
    const base = (this.basesByClass.get(classId) ?? []).find((baseId) => this.hasMethod(baseId, methodName, new Set()));
    return base === undefined ? [] : [base];
  }

  /** When the class of the object is not written: the single known class that has the method, if any. */
  private onlyKnownClassWith(caller: Caller, methodName: string): string[] {
    const candidates = caller.classId === undefined ? caller.knownClassIds : [caller.classId, ...caller.knownClassIds];
    const withMethod = candidates.filter((id) => this.hasMethod(id, methodName, new Set()));
    return withMethod.length === 1 ? withMethod : [];
  }

  /** The project classes that a type names, itself or in its template arguments. */
  private classesInType(type: TypeExpression, scope: LookupScope, usingNamespaces: string[]): string[] {
    return unique(collectTypeNames(type).flatMap((name) => this.classesNamed(name, scope, usingNamespaces)));
  }

  /** The project classes that a name of the source refers to; an alias is followed once (spec §2.6). */
  private classesNamed(name: string, scope: LookupScope, usingNamespaces: string[]): string[] {
    const resolution = this.resolver.resolve(name, scope, usingNamespaces);
    if (resolution.kind === 'class') {
      return [resolution.id];
    }
    if (resolution.kind !== 'alias') {
      return [];
    }
    const alias = resolution.alias;
    const classIds: string[] = [];
    for (const aliasedName of collectTypeNames(alias.type)) {
      const aliased = this.resolver.resolve(aliasedName, alias.scope, usingNamespaces);
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

  /** True when `baseId` is a base class of `classId`, directly or through other base classes. */
  private isDerivedFrom(classId: string, baseId: string, visited: Set<string>): boolean {
    if (visited.has(classId)) {
      return false;
    }
    visited.add(classId);
    return (this.basesByClass.get(classId) ?? []).some((directBaseId) => directBaseId === baseId || this.isDerivedFrom(directBaseId, baseId, visited));
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

function classIdsOf(type: ValueCategory): string[] {
  return type.kind === 'classes' ? type.classIds : [];
}

/** A wrapper can yield one of its element classes by value, reference or pointer. */
function containerElementType(classIds: string[]): ValueCategory {
  return classIds.length === 0 ? { kind: 'unknown' } : { kind: 'classes', classIds, isPointer: undefined };
}

/** Preserve every possible class when overloads or conditional declarations disagree. */
function mergeCategories(types: ValueCategory[]): ValueCategory {
  if (types.length === 1) return types[0];
  const classIds = unique(types.flatMap(classIdsOf));
  if (classIds.length > 0) {
    const first = types[0];
    const sameIndirection = first.kind === 'classes' && types.every((type) => type.kind === 'classes' && type.isPointer === first.isPointer);
    return { kind: 'classes', classIds, isPointer: sameIndirection ? first.isPointer : undefined };
  }
  return types.length > 0 && types.every((type) => type.kind === types[0].kind) ? types[0] : { kind: 'unknown' };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function addToListMap<Value>(map: Map<string, Value[]>, key: string, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
