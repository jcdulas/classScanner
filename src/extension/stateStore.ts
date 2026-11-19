// Reads and writes the saved diagram arrangement (spec §6).
//
// The state of the diagram of a folder is stored in
// `<workspace folder>/.classscanner/<folder name>-<hash>.json`. The hash of the
// absolute folder path keeps two folders with the same name apart. Outside of
// a workspace, the file goes to the extension's global storage instead.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { SavedDiagramFile, SavedDiagramState } from '../shared/savedState';

export class StateStore {
  private readonly filePath: string;
  private readonly workspaceRoot: string | undefined;

  constructor(
    private readonly scannedFolder: string,
    globalStorageFolder: string,
  ) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(scannedFolder));
    this.workspaceRoot = workspaceFolder?.uri.fsPath;
    const storageFolder = this.workspaceRoot === undefined ? globalStorageFolder : path.join(this.workspaceRoot, '.classscanner');
    this.filePath = path.join(storageFolder, stateFileName(scannedFolder));
  }

  /** Returns undefined when nothing was saved yet or when the file cannot be read. */
  async read(): Promise<SavedDiagramFile | undefined> {
    try {
      const content = JSON.parse(await readFile(this.filePath, 'utf8')) as SavedDiagramFile;
      return content.version === 1 ? content : undefined;
    } catch {
      return undefined;
    }
  }

  async write(state: SavedDiagramState, depth: number): Promise<void> {
    const file: SavedDiagramFile = {
      ...state,
      scan: {
        folder: this.workspaceRoot === undefined ? this.scannedFolder : toPosix(path.relative(this.workspaceRoot, this.scannedFolder)),
        depth,
      },
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
  }
}

function stateFileName(scannedFolder: string): string {
  // Windows paths are case-insensitive: the same folder must always give the same file name.
  const normalizedPath = process.platform === 'win32' ? scannedFolder.toLowerCase() : scannedFolder;
  const hash = createHash('sha1').update(normalizedPath).digest('hex').slice(0, 8);
  const folderName = path.basename(scannedFolder).replace(/[^\w.-]/g, '_') || 'root';
  return `${folderName}-${hash}.json`;
}

function toPosix(relativePath: string): string {
  return relativePath === '' ? '.' : relativePath.split(path.sep).join('/');
}
