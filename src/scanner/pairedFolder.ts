// Finds the folder that is paired with a scanned folder (spec §2.2).
//
// Many C++ projects keep their headers and their sources in two sibling
// folders with the same tree inside:
//
//   project/inc/core/engine.h
//   project/src/core/engine.cpp
//
// Scanning `project/src/core` alone would find method definitions without the
// classes they belong to. So when a folder of the scanned path is named like a
// source folder or like a header folder, the same path under its counterpart
// (`project/inc/core` here) is scanned too, when it exists.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Folder names compared without case. The first counterpart that exists wins. */
const SOURCE_FOLDER_NAMES = ['src', 'source', 'sources'];
const HEADER_FOLDER_NAMES = ['inc', 'include', 'includes'];

export interface PairedFolder {
  /** Absolute path of the paired folder, for example `project/inc/core` for `project/src/core`. */
  folder: string;
  /** The folder that contains the two paired trees: `project`. */
  commonParent: string;
}

export async function findPairedFolder(scannedFolder: string): Promise<PairedFolder | undefined> {
  const absoluteFolder = path.resolve(scannedFolder);
  const root = path.parse(absoluteFolder).root;
  const names = absoluteFolder.slice(root.length).split(path.sep).filter((name) => name !== '');

  // From the scanned folder upward: in `src/lib/inc`, the pair of `inc` is looked for first.
  for (let index = names.length - 1; index >= 0; index--) {
    const counterpartNames = counterpartNamesOf(names[index]);
    if (counterpartNames.length === 0) {
      continue;
    }
    const commonParent = path.join(root, ...names.slice(0, index));
    const pathBelow = names.slice(index + 1);
    const siblingNames = await listEntryNames(commonParent);
    for (const counterpartName of counterpartNames) {
      // The name on disk is used, so that `Inc` is found on file systems that distinguish case.
      const siblingName = siblingNames.find((name) => name.toLowerCase() === counterpartName);
      if (siblingName === undefined) {
        continue;
      }
      const candidate = path.join(commonParent, siblingName, ...pathBelow);
      if (await isFolder(candidate)) {
        return { folder: candidate, commonParent };
      }
    }
  }
  return undefined;
}

function counterpartNamesOf(folderName: string): string[] {
  const name = folderName.toLowerCase();
  if (SOURCE_FOLDER_NAMES.includes(name)) {
    return HEADER_FOLDER_NAMES;
  }
  if (HEADER_FOLDER_NAMES.includes(name)) {
    return SOURCE_FOLDER_NAMES;
  }
  return [];
}

async function listEntryNames(folder: string): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch {
    return []; // A folder that cannot be read has no pair to offer.
  }
}

async function isFolder(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
