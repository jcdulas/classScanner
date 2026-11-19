// Small helpers to read tree-sitter syntax nodes.

import { Node } from 'web-tree-sitter';

export type SyntaxNode = Node;

/** Preprocessor nodes whose children are ordinary declarations (one per `#if` branch). */
export const PREPROCESSOR_BLOCK_TYPES = new Set([
  'preproc_if',
  'preproc_ifdef',
  'preproc_else',
  'preproc_elif',
  'preproc_elifdef',
]);

export const CLASS_SPECIFIER_TYPES = new Set(['class_specifier', 'struct_specifier', 'union_specifier']);

/** 1-based line number of the start of the node. */
export function lineOf(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** Collapses all whitespace, including line breaks, into single spaces. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The non-null children of a node, including anonymous tokens such as `virtual` or `{`. */
export function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    if (child !== null) {
      children.push(child);
    }
  }
  return children;
}

export function namedChildrenOf(node: SyntaxNode): SyntaxNode[] {
  return childrenOf(node).filter((child) => child.isNamed);
}

/** True when the node has a direct child of the given type. Works for anonymous tokens too. */
export function hasChildOfType(node: SyntaxNode, type: string): boolean {
  return childrenOf(node).some((child) => child.type === type);
}

/** True when the node has a direct child of the given type whose text is `text`. */
export function hasChildWithText(node: SyntaxNode, type: string, text: string): boolean {
  return childrenOf(node).some((child) => child.type === type && child.text === text);
}

export function isSameNode(first: SyntaxNode | null, second: SyntaxNode | null): boolean {
  return first !== null && second !== null && first.id === second.id;
}

/**
 * Removes template argument lists from a name: `std::map<K, V>::iterator` becomes `std::map::iterator`.
 * Nested lists are handled by counting angle brackets.
 */
export function removeTemplateArguments(text: string): string {
  let result = '';
  let depth = 0;
  for (const character of text) {
    if (character === '<') {
      depth++;
    } else if (character === '>') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      result += character;
    }
  }
  return result.replace(/\s+/g, '');
}
