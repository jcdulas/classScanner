// Resolves a type name, as written in the source, to a project class (spec §2.6).
//
// C++ name lookup is complex and needs the full compiler. This resolver uses
// a few rules that give the right answer in most real code:
//   1. try the name in the current scope, then in each enclosing scope
//      (classes, then namespaces, up to the global namespace), then in each
//      namespace opened by `using namespace`;
//   2. a name that matches a `typedef` or `using` alias returns the alias;
//   3. if nothing matched, accept the class whose short name is unique in the project;
//   4. otherwise the name is unresolved.
// Standard library types, built-in types and template parameters are
// "external": they are not project classes, and not reported as unresolved.

import { LookupScope, TypeAlias } from '../parser/fileSymbols';

export type Resolution =
  | { kind: 'class'; id: string }
  | { kind: 'alias'; alias: TypeAlias }
  | { kind: 'external' }
  | { kind: 'unresolved' };

const BUILTIN_TYPE_NAMES = new Set([
  'void', 'bool', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'auto',
  'wchar_t', 'char8_t', 'char16_t', 'char32_t', 'size_t', 'ssize_t', 'ptrdiff_t', 'nullptr_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'intptr_t', 'uintptr_t', 'intmax_t', 'uintmax_t',
]);

export class TypeResolver {
  private readonly classIds: Set<string>;
  private readonly aliasesByName = new Map<string, TypeAlias>();
  private readonly classIdsByShortName = new Map<string, string[]>();

  constructor(classIds: Iterable<string>, aliases: TypeAlias[]) {
    this.classIds = new Set(classIds);
    for (const id of this.classIds) {
      const shortName = lastSegment(id);
      const sameName = this.classIdsByShortName.get(shortName) ?? [];
      sameName.push(id);
      this.classIdsByShortName.set(shortName, sameName);
    }
    for (const alias of aliases) {
      // A class with the same name wins over an alias (`typedef struct Foo Foo;` is common in C).
      if (!this.classIds.has(alias.qualifiedName)) {
        this.aliasesByName.set(alias.qualifiedName, alias);
      }
    }
  }

  resolve(name: string, scope: LookupScope, usingNamespaces: string[]): Resolution {
    if (isExternalName(name, scope)) {
      return { kind: 'external' };
    }
    for (const candidate of candidateQualifiedNames(name, scope, usingNamespaces)) {
      if (this.classIds.has(candidate)) {
        return { kind: 'class', id: candidate };
      }
      const alias = this.aliasesByName.get(candidate);
      if (alias !== undefined) {
        return { kind: 'alias', alias };
      }
    }
    const sameShortName = this.classIdsByShortName.get(lastSegment(name));
    if (sameShortName !== undefined && sameShortName.length === 1) {
      return { kind: 'class', id: sameShortName[0] };
    }
    return { kind: 'unresolved' };
  }
}

function isExternalName(name: string, scope: LookupScope): boolean {
  if (name === '' || BUILTIN_TYPE_NAMES.has(name) || name.includes(' ')) {
    // Names with a space are built-in types such as `unsigned int` or `long long`.
    return true;
  }
  if (name === 'std' || name.startsWith('std::')) {
    return true;
  }
  return scope.templateParameters.includes(firstSegment(name));
}

/**
 * For `Foo` written in class `a::b::Outer`, the candidates are
 * `a::b::Outer::Foo`, `a::b::Foo`, `a::Foo`, `Foo`, then `<using namespace>::Foo`.
 */
function candidateQualifiedNames(name: string, scope: LookupScope, usingNamespaces: string[]): string[] {
  const candidates: string[] = [];
  const enclosingPath = [...scope.namespacePath, ...scope.classPath];
  for (let length = enclosingPath.length; length >= 0; length--) {
    const prefix = enclosingPath.slice(0, length).join('::');
    candidates.push(prefix === '' ? name : `${prefix}::${name}`);
  }
  for (const usingNamespace of usingNamespaces) {
    candidates.push(`${usingNamespace}::${name}`);
  }
  return candidates;
}

function lastSegment(qualifiedName: string): string {
  const separator = qualifiedName.lastIndexOf('::');
  return separator === -1 ? qualifiedName : qualifiedName.slice(separator + 2);
}

function firstSegment(qualifiedName: string): string {
  const separator = qualifiedName.indexOf('::');
  return separator === -1 ? qualifiedName : qualifiedName.slice(0, separator);
}
