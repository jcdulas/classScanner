// Text shown in the user interface for the values of the model.

import { RelationKind } from '../../shared/graphModel';
import { GroupingKind, LayoutKind } from '../../shared/savedState';
import { InterfaceUse } from '../model/selectionInterface';

export const RELATION_LABELS: Record<RelationKind, string> = {
  inherit: 'Inheritance',
  compose: 'Composition',
  aggregate: 'Aggregation',
  depend: 'Dependency',
  include: 'Include',
  friend: 'Friend',
  nest: 'Nesting',
};

/** The kind of a use in the interface of a selection: a relation kind, or `Call of add()`. */
export function interfaceUseLabel(use: InterfaceUse): string {
  return use.kind === 'call' ? `Call of ${use.calledMethod ?? '?'}()` : RELATION_LABELS[use.kind];
}

export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  grouped: 'Grouped',
  hierarchy: 'Global hierarchy',
  organic: 'Organic',
};

export const GROUPING_LABELS: Record<GroupingKind, string> = {
  namespace: 'Namespace',
  folder: 'Folder',
  file: 'File',
  none: 'None',
};

export const ENTITY_KIND_LABELS: Record<string, string> = {
  class: 'Classes',
  struct: 'Structs',
  union: 'Unions',
  enum: 'Enums',
  template: 'Templates',
};
