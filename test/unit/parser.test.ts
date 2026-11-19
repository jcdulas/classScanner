// Tests of the C++ extractor on the fixture corpus in test/fixtures/constructs.

import { describe, expect, it } from 'vitest';
import { MemberFlags } from '../../src/shared/graphModel';
import { findType, parseConstructFixture, parseSource } from './testHelpers';

describe('inheritance', () => {
  it('reads base classes with their access level and virtual keyword', async () => {
    const symbols = await parseConstructFixture('inheritance.hpp');
    const derived = findType(symbols, 'Derived');
    expect(derived.bases.map((base) => [base.type.name, base.access, base.isVirtual])).toEqual([
      ['Base', 'public', false],
      ['Mixin', 'protected', true],
      ['Other', 'private', false],
    ]);
  });

  it('uses public as the default base access of a struct', async () => {
    const symbols = await parseConstructFixture('inheritance.hpp');
    expect(findType(symbols, 'PublicByDefault').bases[0].access).toBe('public');
  });

  it('reads template base classes and template parameters', async () => {
    const symbols = await parseConstructFixture('inheritance.hpp');
    const wrapper = findType(symbols, 'Wrapper');
    expect(wrapper.templateParameters).toEqual(['T']);
    expect(wrapper.bases[1].type.name).toBe('Container');
    expect(wrapper.bases[1].type.templateArguments[0].name).toBe('T');
  });
});

describe('members', () => {
  it('reads attributes with their type, visibility and static flag', async () => {
    const shape = findType(await parseConstructFixture('members.hpp'), 'Shape');
    const attributes = shape.attributes.map((attribute) => [attribute.name, attribute.typeText, attribute.visibility]);
    expect(attributes).toEqual([
      ['color', 'Color', 'protected'],
      ['origin', 'Point*', 'protected'],
      ['center', 'Point*', 'protected'],
      ['kMaxSides', 'const int', 'protected'],
      ['sides_', 'int', 'private'],
      ['weights', 'float[4]', 'private'],
      ['callback', 'void (*)(int)', 'private'],
    ]);
    expect(shape.attributes.find((attribute) => attribute.name === 'kMaxSides')?.isStatic).toBe(true);
    expect(shape.attributes.find((attribute) => attribute.name === 'origin')?.type.indirection).toBe('pointer');
    expect(shape.attributes.find((attribute) => attribute.name === 'weights')?.type.isArray).toBe(true);
  });

  it('reads methods with their signature and flags', async () => {
    const shape = findType(await parseConstructFixture('members.hpp'), 'Shape');
    const methods = Object.fromEntries(shape.methods.map((method) => [method.name, method]));
    expect(Object.keys(methods)).toEqual(['Shape', '~Shape', 'area', 'create', 'operator=', 'sides', 'draw']);
    expect(methods['area'].signature).toBe('() const: double');
    expect(methods['area'].flags).toBe(MemberFlags.Virtual | MemberFlags.PureVirtual | MemberFlags.Const);
    expect(methods['create'].signature).toBe('(const char* name): Shape*');
    expect(methods['create'].flags).toBe(MemberFlags.Static);
    expect(methods['~Shape'].flags).toBe(MemberFlags.Virtual);
    expect(methods['draw'].flags).toBe(MemberFlags.Virtual);
    expect(methods['sides'].flags).toBe(MemberFlags.Const);
  });

  it('uses public as the default member visibility of a struct', async () => {
    const plain = findType(await parseConstructFixture('members.hpp'), 'Plain');
    expect(plain.attributes[0].visibility).toBe('public');
  });
});

describe('templates', () => {
  it('records specializations as such', async () => {
    const symbols = await parseConstructFixture('templates.hpp');
    const specializations = symbols.types.filter((type) => type.specializationOf !== undefined);
    expect(specializations.map((type) => type.specializationName)).toEqual(['Buffer<bool, 8>', 'Buffer<T*, 1>']);
    const primary = symbols.types.find((type) => type.specializationOf === undefined);
    expect(primary?.templateParameters).toEqual(['T', 'N']);
  });

  it('records a template forward declaration', async () => {
    const symbols = await parseConstructFixture('templates.hpp');
    expect(symbols.forwardDeclarations.map((declaration) => declaration.qualifiedName)).toEqual(['Pair']);
  });
});

describe('nested types', () => {
  it('qualifies nested classes and enums with their outer class', async () => {
    const symbols = await parseConstructFixture('nested.hpp');
    const state = findType(symbols, 'ui::Window::State');
    expect(state.outerClass).toBe('ui::Window');
    expect(state.enumValues).toEqual(['Hidden', 'Shown', 'Minimized']);
    expect(findType(symbols, 'ui::Window::Geometry').outerClass).toBe('ui::Window');
  });

  it('handles a nested class defined outside its outer class', async () => {
    const symbols = await parseConstructFixture('nested.hpp');
    const impl = findType(symbols, 'ui::Window::Impl');
    expect(impl.outerClass).toBe('ui::Window');
    expect(impl.namespace).toBe('ui');
    expect(impl.scope.classPath).toEqual(['Window', 'Impl']);
  });
});

describe('macros', () => {
  it('removes export macros automatically and configured macros on request', async () => {
    const symbols = await parseConstructFixture('macros.hpp', ['Q_OBJECT', 'DECLARE_DYNAMIC']);
    expect(symbols.types.map((type) => type.qualifiedName)).toEqual(['Exported', 'Widget', 'Renderer']);
    expect(findType(symbols, 'Widget').bases[0].type.name).toBe('Exported');
    expect(findType(symbols, 'Widget').methods[0].visibility).toBe('public');
    expect(findType(symbols, 'Renderer').attributes[0].name).toBe('frames');
    expect(symbols.parseErrorCount).toBe(0);
  });

  it('keeps line numbers unchanged', async () => {
    const symbols = await parseConstructFixture('macros.hpp', ['Q_OBJECT', 'DECLARE_DYNAMIC']);
    expect(findType(symbols, 'Exported').line).toBe(2);
    expect(findType(symbols, 'Renderer').attributes[0].line).toBe(16);
  });

  it('does not remove a class name followed by final', async () => {
    const symbols = await parseSource('class RGB final : public Color {};');
    expect(symbols.types[0].name).toBe('RGB');
  });
});

describe('preprocessor', () => {
  it('parses every branch of #if blocks', async () => {
    const symbols = await parseConstructFixture('preprocessor.hpp');
    expect(symbols.types.filter((type) => type.name === 'Backend')).toHaveLength(2);
    const engine = findType(symbols, 'Engine');
    expect(engine.attributes.map((attribute) => attribute.name)).toEqual(['fast', 'slow']);
    expect(engine.methods[0].visibility).toBe('public');
  });

  it('reads include directives', async () => {
    const symbols = await parseConstructFixture('preprocessor.hpp');
    expect(symbols.includes).toEqual([
      { path: 'core/device.h', isSystem: false },
      { path: 'vector', isSystem: true },
    ]);
  });
});

describe('namespaces and aliases', () => {
  it('qualifies names with nested and C++17 namespaces', async () => {
    const symbols = await parseConstructFixture('namespaces.hpp');
    const names = symbols.types.map((type) => type.qualifiedName);
    expect(names).toEqual(['app::core::Service', 'app::net::http::Request', 'app::Point', '(anonymous)::Hidden', 'CStruct']);
    expect(symbols.usingNamespaces).toEqual(['std']);
  });

  it('reads using and typedef aliases', async () => {
    const symbols = await parseConstructFixture('namespaces.hpp');
    expect(symbols.aliases.map((alias) => [alias.qualifiedName, alias.type.name])).toEqual([
      ['app::net::http::RequestList', 'std::vector'],
      ['app::net::http::RequestMap', 'std::map'],
    ]);
  });
});

describe('method definitions outside their class', () => {
  it('records the owner and the type names used in the body', async () => {
    const symbols = await parseConstructFixture('definitions.cpp');
    const run = symbols.outOfClassMethods[0];
    expect(run.ownerName).toBe('core::Engine');
    expect(run.scope.namespacePath).toEqual(['app']);
    expect(run.bodyTypeNames).toEqual(['Timer', 'Factory', 'Registry', 'DerivedScene']);
    expect(run.signatureTypes.map((type) => type.name)).toEqual(['Scene', 'void']);
  });

  it('removes template arguments from the owner and ignores free functions', async () => {
    const symbols = await parseConstructFixture('definitions.cpp');
    expect(symbols.outOfClassMethods.map((method) => method.ownerName)).toEqual(['core::Engine', 'Pool', 'Engine']);
    expect(symbols.outOfClassMethods[1].scope.templateParameters).toEqual(['T']);
  });
});

describe('friends', () => {
  it('reads friend classes and skips friend functions', async () => {
    const secret = findType(await parseConstructFixture('friends.hpp'), 'Secret');
    expect(secret.friends).toEqual(['Inspector', 'ns::Auditor']);
  });
});
