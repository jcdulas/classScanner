// Finds, for a method defined outside its class, the method of the class that it defines.
//
// A method is usually declared in a header and defined in a .cpp file:
// `void run();` in the class, `void Engine::run() { ... }` elsewhere. The
// diagram opens either place (spec §4.6), so each method of a class remembers
// where it is defined.
//
// A class can have several methods of the same name (overloads). They are told
// apart by the types of their parameters and of their return value, compared
// by their short names: the definition often writes `Scene::Item` where the
// class body writes `Item`.

import { TypeExpression } from '../parser/fileSymbols';
import { Member, SourceLocation } from '../shared/graphModel';

interface DeclaredMethod {
  member: Member;
  signatureKey: string;
}

export class MethodDefinitions {
  private readonly methodsByClass = new Map<string, DeclaredMethod[]>();

  /** Records a method declared in the body of a class. */
  addDeclaredMethod(classId: string, member: Member, signatureTypes: TypeExpression[]): void {
    const methods = this.methodsByClass.get(classId) ?? [];
    methods.push({ member, signatureKey: signatureKeyOf(signatureTypes) });
    this.methodsByClass.set(classId, methods);
  }

  /** Records where a method of a class is defined, on the method that the definition matches. */
  addDefinition(classId: string, methodName: string, signatureTypes: TypeExpression[], location: SourceLocation): void {
    const sameName = (this.methodsByClass.get(classId) ?? []).filter((method) => method.member.name === methodName);
    const signatureKey = signatureKeyOf(signatureTypes);
    // Two overloads can have the same types, such as `begin()` and `begin() const`: definitions
    // are then given to them in order, as they are usually written in the order of the class.
    const sameSignature = sameName.find((method) => method.signatureKey === signatureKey && method.member.definition === undefined);
    // A single method of that name is the one, even when its types are written another way.
    const declared = sameSignature ?? (sameName.length === 1 ? sameName[0] : undefined);
    // The first definition is kept: a method can be defined once per platform, in `#if` branches.
    if (declared !== undefined && declared.member.definition === undefined) {
      declared.member.definition = location;
    }
  }
}

function signatureKeyOf(types: TypeExpression[]): string {
  return types.map(typeKeyOf).join(',');
}

function typeKeyOf(type: TypeExpression): string {
  const nameParts = type.name.split('::');
  const shortName = nameParts[nameParts.length - 1];
  const argumentKeys = type.templateArguments.length === 0 ? '' : `<${signatureKeyOf(type.templateArguments)}>`;
  return `${shortName}${argumentKeys} ${type.indirection}${type.isArray ? '[]' : ''}`;
}
