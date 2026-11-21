// Generates a synthetic C++ project used to measure the performance targets (spec §8, §9).
//
// The default size matches the reference project of the spec: 1500 classes
// in 2000 files (one header per class, plus .cpp files with method bodies).
// The generator is deterministic: the same options always give the same project.
//
// Usage: node scripts/generateSyntheticProject.mjs [--classes 1500] [--cpp-files 500]
//        [--relations 4] [--output test/synthetic-project]

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readOption(name, defaultValue) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? defaultValue : process.argv[index + 1];
}

const classCount = Number(readOption('classes', 1500));
const cppFileCount = Number(readOption('cpp-files', 500));
/** Average number of member relations (attributes and parameters) per class. */
const relationsPerClass = Number(readOption('relations', 4));
const outputFolder = path.resolve(projectRoot, readOption('output', 'test/synthetic-project'));

/** A small deterministic pseudo-random generator (mulberry32), so runs are comparable. */
function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(42);
const pick = (items) => items[Math.floor(random() * items.length)];

const MODULES = ['core', 'render', 'physics', 'audio', 'net', 'ui', 'io', 'script', 'scene', 'tools'];
const SUBMODULES = ['detail', 'api', 'impl', 'util'];

function createClasses() {
  const classes = [];
  for (let index = 0; index < classCount; index++) {
    const module = MODULES[index % MODULES.length];
    const submodule = SUBMODULES[Math.floor(index / MODULES.length) % SUBMODULES.length];
    classes.push({
      index,
      name: `Class${index}`,
      namespace: `engine::${module}::${submodule}`,
      folder: `${module}/${submodule}`,
    });
  }
  return classes;
}

function memberFor(target, memberIndex) {
  const forms = [
    (type) => `${type} value${memberIndex};`,
    (type) => `${type}* pointer${memberIndex};`,
    (type) => `std::vector<${type}> items${memberIndex};`,
    (type) => `std::unique_ptr<${type}> owned${memberIndex};`,
    (type) => `std::shared_ptr<${type}> shared${memberIndex};`,
  ];
  return pick(forms)(qualified(target));
}

function qualified(classInfo) {
  return `${classInfo.namespace}::${classInfo.name}`;
}

function headerPath(classInfo) {
  return `include/${classInfo.folder}/${classInfo.name}.h`;
}

function generateHeader(classInfo, classes) {
  const lines = ['#pragma once', '#include <memory>', '#include <vector>'];
  // Bases and members only refer to earlier classes, so that inheritance has no cycles.
  const earlier = classes.slice(0, classInfo.index);
  const base = earlier.length > 0 && random() < 0.7 ? pick(earlier) : undefined;
  const relationTargets = [];
  for (let count = 0; count < relationsPerClass && earlier.length > 0; count++) {
    relationTargets.push(pick(earlier));
  }
  for (const target of new Set([base, ...relationTargets].filter(Boolean))) {
    lines.push(`#include "${path.posix.relative(path.posix.dirname(headerPath(classInfo)), headerPath(target))}"`);
  }
  lines.push('', `namespace ${classInfo.namespace} {`, '');
  lines.push(`class ${classInfo.name}${base === undefined ? '' : ` : public ${qualified(base)}`} {`);
  lines.push('public:');
  lines.push(`  ${classInfo.name}();`);
  lines.push(`  virtual ~${classInfo.name}();`);
  const memberLines = relationTargets.map((target, index) => `  ${memberFor(target, index)}`);
  const methodCount = 2 + Math.floor(random() * 10);
  for (let index = 0; index < methodCount; index++) {
    const parameter = earlier.length > 0 && random() < 0.4 ? `const ${qualified(pick(earlier))}& input` : 'int value';
    lines.push(`  ${random() < 0.3 ? 'virtual ' : ''}int method${index}(${parameter})${random() < 0.5 ? ' const' : ''};`);
  }
  lines.push('', 'private:', ...memberLines);
  const attributeCount = Math.floor(random() * 6);
  for (let index = 0; index < attributeCount; index++) {
    lines.push(`  ${pick(['int', 'double', 'bool', 'std::string'])} field${index}_;`);
  }
  lines.push('};', '', `}  // namespace ${classInfo.namespace}`, '');
  return lines.join('\n');
}

function generateSource(fileIndex, classes) {
  const owners = [];
  for (let count = 0; count < 3; count++) {
    owners.push(classes[(fileIndex * 3 + count) % classes.length]);
  }
  const lines = owners.map((owner) => `#include "../include/${owner.folder}/${owner.name}.h"`);
  lines.push('');
  for (const owner of owners) {
    const used = pick(classes);
    lines.push(`${qualified(owner)}::${owner.name}() {`);
    lines.push(`  ${qualified(used)} helper;`);
    // A method call between two classes (every class has a `method0`).
    lines.push('  helper.method0(1);');
    lines.push(`  auto* created = new ${qualified(pick(classes))}();`);
    lines.push('  (void)created;', '}', '');
    lines.push(`${qualified(owner)}::~${owner.name}() {}`, '');
  }
  return lines.join('\n');
}

async function main() {
  await rm(outputFolder, { recursive: true, force: true });
  const classes = createClasses();
  for (const classInfo of classes) {
    const filePath = path.join(outputFolder, headerPath(classInfo));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, generateHeader(classInfo, classes));
  }
  await mkdir(path.join(outputFolder, 'src'), { recursive: true });
  for (let index = 0; index < cppFileCount; index++) {
    await writeFile(path.join(outputFolder, 'src', `source${index}.cpp`), generateSource(index, classes));
  }
  console.log(`Generated ${classCount} classes in ${classCount + cppFileCount} files in ${outputFolder}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
