// Groups classes by namespace, folder or file (spec §4.4), and defines the
// geometry of a group box: a frame around its cards with a title band on top.

import { ClassNode } from '../../shared/graphModel';
import { GroupingKind } from '../../shared/savedState';

export const GROUP_STYLE = {
  padding: 24,
  titleHeight: 36,
  /** Size of the single card that replaces a collapsed group. */
  collapsedWidth: 240,
  collapsedHeight: 64,
};

/** Key of the group containing every class when grouping is `none`. */
export const NO_GROUP = '';

export function groupKeyOf(node: ClassNode, grouping: GroupingKind, files: string[]): string {
  switch (grouping) {
    case 'namespace':
      return node.namespace;
    case 'folder':
      return folderOf(files[node.file] ?? '');
    case 'file':
      return files[node.file] ?? '';
    case 'none':
      return NO_GROUP;
  }
}

export function groupLabel(key: string, grouping: GroupingKind): string {
  if (grouping === 'namespace') {
    return key === '' ? '(global namespace)' : key;
  }
  if (grouping === 'folder') {
    return key === '' ? '(scanned folder)' : key;
  }
  return key;
}

/** `src/core/engine.h` gives `src/core`; a file at the root gives an empty string. */
export function folderOf(relativePath: string): string {
  const separator = relativePath.lastIndexOf('/');
  return separator === -1 ? '' : relativePath.slice(0, separator);
}
