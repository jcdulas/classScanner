// Reads the `classScanner.*` settings declared in package.json (spec §7).

import * as vscode from 'vscode';
import { ALL_RELATION_KINDS, RelationKind } from '../shared/graphModel';

export interface ExtensionSettings {
  maxDepth: number;
  extensions: string[];
  exclude: string[];
  maxFileSizeKB: number;
  ignoredMacros: string[];
  maxMembersInAutoMode: number;
  structuralRelations: RelationKind[];
}

export function readSettings(): ExtensionSettings {
  const configuration = vscode.workspace.getConfiguration('classScanner');
  const structuralRelations = configuration
    .get<string[]>('structuralRelations', ['inherit', 'compose'])
    .filter((kind): kind is RelationKind => (ALL_RELATION_KINDS as string[]).includes(kind));
  return {
    maxDepth: configuration.get<number>('maxDepth', -1),
    extensions: configuration.get<string[]>('extensions', ['.cpp', '.hpp', '.h']),
    exclude: configuration.get<string[]>('exclude', []),
    maxFileSizeKB: configuration.get<number>('maxFileSizeKB', 2048),
    ignoredMacros: configuration.get<string[]>('ignoredMacros', []),
    maxMembersInAutoMode: Math.max(1, configuration.get<number>('maxMembersInAutoMode', 12)),
    structuralRelations,
  };
}
