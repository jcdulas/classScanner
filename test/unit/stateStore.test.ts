// Checks personal diagram storage and compatibility with the previous storage locations.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { StateStore } from '../../src/extension/stateStore';
import { createDefaultState } from '../../src/shared/savedState';

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'classscanner-state-'));
  home = path.join(root, 'home');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('keeps same-named projects separate and writes only in the personal directory', async () => {
  for (const depth of [0, 1]) {
    const folder = path.join(root, String(depth), 'project');
    await mkdir(folder, { recursive: true });
    const store = new StateStore(folder, path.join(folder, '.classscanner'), home);
    await store.write(createDefaultState(), depth);
    expect(await readdir(folder)).toEqual([]);
  }
  expect(await readdir(path.join(home, '.classscanner'))).toHaveLength(2);
  for (const depth of [0, 1]) {
    const folder = path.join(root, String(depth), 'project');
    expect((await new StateStore(folder, undefined, home).read())?.scan).toEqual({ folder, depth });
  }
});

it.each(['workspace', 'global'])('restores the previous %s file until the user saves a personal copy', async (location) => {
  const folder = path.join(root, 'project');
  const legacyDirectory = location === 'workspace' ? path.join(folder, '.classscanner') : path.join(root, 'globalStorage');
  await mkdir(legacyDirectory, { recursive: true });
  const normalized = process.platform === 'win32' ? folder.toLowerCase() : folder;
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const legacyPath = path.join(legacyDirectory, `project-${hash}.json`);
  const legacy = { ...createDefaultState(), collapsedGroups: ['geo'], scan: { folder: location === 'workspace' ? '.' : folder, depth: 2 } };
  await writeFile(legacyPath, JSON.stringify(legacy));

  const store = new StateStore(folder, legacyDirectory, home);
  expect(await store.read()).toEqual(legacy);
  await store.write({ ...legacy, collapsedGroups: [] }, 3);
  expect(await store.read()).toMatchObject({ collapsedGroups: [], scan: { folder, depth: 3 } });
  expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(legacy);
});
