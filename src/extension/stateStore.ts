// Reads and writes the saved diagram arrangement (spec §6).
//
// Each user has one arrangement per scanned folder in ~/.classscanner.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { SavedDiagramFile, SavedDiagramState } from '../shared/savedState';

export class StateStore {
  private readonly filePath: string;

  constructor(
    private readonly scannedFolder: string,
    private readonly legacyStorageFolder?: string,
    userHome = homedir(),
  ) {
    this.filePath = path.join(userHome, '.classscanner', stateFileName(scannedFolder));
  }

  /** Returns undefined when nothing was saved yet or when the file cannot be read. */
  async read(): Promise<SavedDiagramFile | undefined> {
    try {
      let json: string;
      try {
        json = await readFile(this.filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || this.legacyStorageFolder === undefined) {
          throw error;
        }
        // The next normal save writes the restored arrangement to the user's home.
        json = await readFile(path.join(this.legacyStorageFolder, path.basename(this.filePath)), 'utf8');
      }
      const content = JSON.parse(json) as SavedDiagramFile;
      return content.version === 1 ? content : undefined;
    } catch {
      return undefined;
    }
  }

  async write(state: SavedDiagramState, depth: number): Promise<void> {
    const file: SavedDiagramFile = {
      ...state,
      scan: {
        folder: this.scannedFolder,
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
