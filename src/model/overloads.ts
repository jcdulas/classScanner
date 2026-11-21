// Chooses which overload of a method a call uses, from its arguments (spec §3.1).
//
// A class can have several methods of the same name, told apart by their
// parameters: `Job* find(int id)` and `Task* find(const std::string& name)`.
// What `registry.find(42)` returns depends on which one is called, and so does
// the class that the next call of a chain goes to.
//
// A compiler ranks the overloads by how well each argument fits each
// parameter. The same idea is applied here with what the scan knows:
//   1. an overload that the number of arguments does not fit is left out;
//   2. each argument is compared with its parameter and gets a rank: the same
//      type, a conversion that the language does by itself (a number to
//      another number, a derived class to its base class), a conversion that
//      a class may define, or no possible conversion;
//   3. an overload with an argument that cannot be converted is left out, and
//      among the others the ones with the best total rank are kept.
// When nothing can be told, several overloads are kept: the caller then takes
// the return types of all of them, as before.
//
// This is not the full rule of the language: templates, conversions defined by
// classes and the finer ranks of the standard are not worked out.

import { LiteralKind } from '../parser/fileSymbols';

/** What is known of the type of a parameter, or of an argument. */
export type ValueCategory =
  /** Its type names project classes. */
  | { kind: 'classes'; classIds: string[]; isPointer: boolean | undefined }
  /** A type of the language or of the standard library. */
  | { kind: 'integer' | 'floating' | 'boolean' | 'character' | 'characterPointer' | 'string' | 'pointer' }
  /** `nullptr`. */
  | { kind: 'null' }
  /** A type that is not known: a template parameter, a class outside the scanned files. */
  | { kind: 'unknown' };

/** One overload: its parameters, in order, and how many arguments a call can give. */
export interface OverloadParameters {
  categories: ValueCategory[];
  requiredCount: number;
  isVariadic: boolean;
}

/** How well an argument fits a parameter; the higher, the better. */
const RANK_SAME_TYPE = 3;
const RANK_LANGUAGE_CONVERSION = 2;
const RANK_POSSIBLE_CONVERSION = 1;
const RANK_UNKNOWN = 0;
const RANK_IMPOSSIBLE = -1;

const INTEGER_TYPE_NAMES = new Set([
  'int',
  'unsigned',
  'unsigned int',
  'long',
  'unsigned long',
  'long long',
  'unsigned long long',
  'short',
  'unsigned short',
  'size_t',
  'std::size_t',
  'ssize_t',
  'ptrdiff_t',
  'std::ptrdiff_t',
  'int8_t',
  'int16_t',
  'int32_t',
  'int64_t',
  'uint8_t',
  'uint16_t',
  'uint32_t',
  'uint64_t',
  'std::int8_t',
  'std::int16_t',
  'std::int32_t',
  'std::int64_t',
  'std::uint8_t',
  'std::uint16_t',
  'std::uint32_t',
  'std::uint64_t',
]);
const FLOATING_TYPE_NAMES = new Set(['float', 'double', 'long double']);
const CHARACTER_TYPE_NAMES = new Set(['char', 'unsigned char', 'signed char', 'wchar_t', 'char8_t', 'char16_t', 'char32_t']);
const STRING_TYPE_NAMES = new Set(['std::string', 'string', 'std::string_view', 'string_view', 'std::wstring', 'wstring']);

/** The category of a type that names no project class, from its name as written and whether it is a pointer. */
export function categoryOfTypeName(typeName: string, isPointer: boolean): ValueCategory {
  const name = typeName.replace(/\b(const|volatile|signed)\b/g, '').replace(/\s+/g, ' ').trim();
  if (CHARACTER_TYPE_NAMES.has(name)) {
    return { kind: isPointer ? 'characterPointer' : 'character' };
  }
  if (isPointer) {
    return { kind: 'pointer' };
  }
  if (name === 'bool') {
    return { kind: 'boolean' };
  }
  if (INTEGER_TYPE_NAMES.has(name)) {
    return { kind: 'integer' };
  }
  if (FLOATING_TYPE_NAMES.has(name)) {
    return { kind: 'floating' };
  }
  return STRING_TYPE_NAMES.has(name) ? { kind: 'string' } : { kind: 'unknown' };
}

export function categoryOfLiteral(literal: LiteralKind): ValueCategory {
  switch (literal) {
    case 'string':
      // A text between quotes is an array of characters, used as a pointer to its first one.
      return { kind: 'characterPointer' };
    case 'null':
      return { kind: 'null' };
    default:
      return { kind: literal };
  }
}

/**
 * The overloads that the arguments of a call fit best; all of them when nothing tells them apart.
 * `argumentCategories` is undefined when the arguments are not known.
 * `isDerivedFrom(classId, baseId)` tells whether a class has another one among its base classes.
 */
export function chooseOverloads<Overload extends OverloadParameters>(
  overloads: Overload[],
  argumentCategories: ValueCategory[] | undefined,
  isDerivedFrom: (classId: string, baseId: string) => boolean,
): Overload[] {
  if (overloads.length <= 1 || argumentCategories === undefined) {
    return overloads;
  }
  const argumentCount = argumentCategories.length;
  const fittingCount = overloads.filter(
    (overload) => argumentCount >= overload.requiredCount && (overload.isVariadic || argumentCount <= overload.categories.length),
  );
  // No overload takes that many arguments: the call was misread (a macro, for example).
  const candidates = fittingCount.length > 0 ? fittingCount : overloads;

  let best: Overload[] = [];
  let bestRank = RANK_IMPOSSIBLE;
  for (const overload of candidates) {
    const rank = rankOfOverload(overload, argumentCategories, isDerivedFrom);
    if (rank > bestRank) {
      best = [overload];
      bestRank = rank;
    } else if (rank === bestRank && rank !== RANK_IMPOSSIBLE) {
      best.push(overload);
    }
  }
  // Every overload has an argument that looks impossible: a conversion that the scan does not know.
  return best.length > 0 ? best : candidates;
}

/** The sum of the ranks of the arguments, or RANK_IMPOSSIBLE when one of them cannot be given to its parameter. */
function rankOfOverload(overload: OverloadParameters, argumentCategories: ValueCategory[], isDerivedFrom: (classId: string, baseId: string) => boolean): number {
  let total = 0;
  for (const [index, argument] of argumentCategories.entries()) {
    const parameter = overload.categories[index];
    // Beyond the declared parameters: an argument of `...`, which takes anything.
    const rank = parameter === undefined ? RANK_UNKNOWN : rankOfArgument(argument, parameter, isDerivedFrom);
    if (rank === RANK_IMPOSSIBLE) {
      return RANK_IMPOSSIBLE;
    }
    total += rank;
  }
  return total;
}

/** How well a value of the category `argument` can be given to a parameter of the category `parameter`. */
export function rankOfArgument(argument: ValueCategory, parameter: ValueCategory, isDerivedFrom: (classId: string, baseId: string) => boolean): number {
  if (argument.kind === 'unknown' || parameter.kind === 'unknown') {
    return RANK_UNKNOWN;
  }
  if (argument.kind === 'classes') {
    if (parameter.kind !== 'classes') {
      if (argument.isPointer && parameter.kind === 'boolean') {
        return RANK_LANGUAGE_CONVERSION;
      }
      // An object is not a number nor a text, unless its class says how to become one.
      return RANK_IMPOSSIBLE;
    }
    if (argument.isPointer !== undefined && parameter.isPointer !== undefined && argument.isPointer !== parameter.isPointer) {
      return RANK_IMPOSSIBLE;
    }
    if (argument.classIds.some((classId) => parameter.classIds.includes(classId))) {
      return RANK_SAME_TYPE;
    }
    const isBaseOfArgument = argument.classIds.some((classId) => parameter.classIds.some((baseId) => isDerivedFrom(classId, baseId)));
    return isBaseOfArgument ? RANK_LANGUAGE_CONVERSION : RANK_IMPOSSIBLE;
  }
  if (parameter.kind === 'classes') {
    // `nullptr` is a pointer to any class. Another value needs a constructor of the class that takes it.
    if (argument.kind === 'null') {
      return parameter.isPointer ? RANK_SAME_TYPE : RANK_POSSIBLE_CONVERSION;
    }
    return parameter.isPointer ? RANK_IMPOSSIBLE : RANK_POSSIBLE_CONVERSION;
  }
  if (argument.kind === parameter.kind) {
    return RANK_SAME_TYPE;
  }
  if (argument.kind === 'null') {
    const isPointerParameter = parameter.kind === 'pointer' || parameter.kind === 'characterPointer';
    return isPointerParameter ? RANK_SAME_TYPE : RANK_IMPOSSIBLE;
  }
  const numberKinds = ['integer', 'floating', 'boolean', 'character'];
  if (numberKinds.includes(argument.kind) && numberKinds.includes(parameter.kind)) {
    return RANK_LANGUAGE_CONVERSION;
  }
  if (argument.kind === 'characterPointer') {
    // The language turns a pointer into `true` or `false` by itself, and prefers that to the
    // constructor of `std::string`: `log("text")` calls `log(bool)` rather than `log(std::string)`.
    if (parameter.kind === 'boolean') {
      return RANK_LANGUAGE_CONVERSION;
    }
    if (parameter.kind === 'string') {
      return RANK_POSSIBLE_CONVERSION;
    }
  }
  if (argument.kind === 'characterPointer' && parameter.kind === 'pointer') {
    // To a `void*`, for example.
    return RANK_LANGUAGE_CONVERSION;
  }
  if (argument.kind === 'pointer' && parameter.kind === 'boolean') {
    return RANK_LANGUAGE_CONVERSION;
  }
  return RANK_IMPOSSIBLE;
}
