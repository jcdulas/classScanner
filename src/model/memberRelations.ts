// Turns the type of an attribute into composition and aggregation relations (spec §3).
//
// The rules follow ownership:
//   - a member held by value, by `std::unique_ptr` or by `std::optional` is
//     owned by the class: composition;
//   - a member held by pointer, by reference, by `std::shared_ptr` or by
//     `std::weak_ptr` is shared or borrowed: aggregation;
//   - a container (`std::vector<T>`, `std::map<K, V>`...) or a C array gives a
//     multiplicity of `*`, and its element types keep the ownership rule.
// The walk goes into template arguments, so `std::map<Key, std::shared_ptr<Value>>`
// gives a composition to `Key` and an aggregation to `Value`.

import { LookupScope, TypeExpression } from '../parser/fileSymbols';
import { TypeResolver } from './typeResolver';

export interface MemberRelation {
  targetId: string;
  kind: 'compose' | 'aggregate';
  multiplicity: '1' | '*';
}

type WrapperKind = 'owning' | 'sharing' | 'container';

/** Library templates that wrap other types. Names are given without the `std::` prefix. */
const WRAPPER_KINDS = new Map<string, WrapperKind>([
  ['unique_ptr', 'owning'],
  ['optional', 'owning'],
  ['pair', 'owning'],
  ['tuple', 'owning'],
  ['variant', 'owning'],
  ['atomic', 'owning'],
  ['QScopedPointer', 'owning'],
  ['shared_ptr', 'sharing'],
  ['weak_ptr', 'sharing'],
  ['reference_wrapper', 'sharing'],
  ['QSharedPointer', 'sharing'],
  ['QWeakPointer', 'sharing'],
  ['QPointer', 'sharing'],
  ['vector', 'container'],
  ['array', 'container'],
  ['list', 'container'],
  ['forward_list', 'container'],
  ['deque', 'container'],
  ['set', 'container'],
  ['multiset', 'container'],
  ['unordered_set', 'container'],
  ['unordered_multiset', 'container'],
  ['map', 'container'],
  ['multimap', 'container'],
  ['unordered_map', 'container'],
  ['unordered_multimap', 'container'],
  ['stack', 'container'],
  ['queue', 'container'],
  ['priority_queue', 'container'],
  ['span', 'container'],
  ['QList', 'container'],
  ['QVector', 'container'],
  ['QMap', 'container'],
  ['QHash', 'container'],
  ['QSet', 'container'],
]);

interface WalkState {
  kind: 'compose' | 'aggregate';
  multiplicity: '1' | '*';
  /** True once an alias has been expanded: aliases are only expanded one level deep (spec §2.6). */
  isInsideAlias: boolean;
}

export class MemberRelationClassifier {
  /** Type names that matched no project class, for the scan report. */
  readonly unresolvedNames: string[] = [];

  constructor(private readonly resolver: TypeResolver) {}

  classify(type: TypeExpression, scope: LookupScope, usingNamespaces: string[]): MemberRelation[] {
    const relations: MemberRelation[] = [];
    const initialState: WalkState = { kind: 'compose', multiplicity: '1', isInsideAlias: false };
    this.walk(type, scope, usingNamespaces, initialState, relations);
    return relations;
  }

  private walk(
    type: TypeExpression,
    scope: LookupScope,
    usingNamespaces: string[],
    parentState: WalkState,
    relations: MemberRelation[],
  ): void {
    const state: WalkState = {
      kind: type.indirection === 'value' ? parentState.kind : 'aggregate',
      multiplicity: type.isArray ? '*' : parentState.multiplicity,
      isInsideAlias: parentState.isInsideAlias,
    };

    const wrapperKind = WRAPPER_KINDS.get(type.name.replace(/^std::/, ''));
    if (wrapperKind !== undefined) {
      const argumentState: WalkState = {
        ...state,
        kind: wrapperKind === 'sharing' ? 'aggregate' : state.kind,
        multiplicity: wrapperKind === 'container' ? '*' : state.multiplicity,
      };
      for (const argument of type.templateArguments) {
        this.walk(argument, scope, usingNamespaces, argumentState, relations);
      }
      return;
    }

    const resolution = this.resolver.resolve(type.name, scope, usingNamespaces);
    if (resolution.kind === 'class') {
      relations.push({ targetId: resolution.id, kind: state.kind, multiplicity: state.multiplicity });
    } else if (resolution.kind === 'alias' && !state.isInsideAlias) {
      const alias = resolution.alias;
      this.walk(alias.type, alias.scope, usingNamespaces, { ...state, isInsideAlias: true }, relations);
    } else if (resolution.kind === 'unresolved') {
      this.unresolvedNames.push(type.name);
    }

    // Arguments of a project template, such as `Foo` in `Handle<Foo>`, are explored with the same rules.
    for (const argument of type.templateArguments) {
      this.walk(argument, scope, usingNamespaces, state, relations);
    }
  }
}
