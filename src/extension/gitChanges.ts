// Asks git which lines of the sources changed since a reference, for the
// "Changes" list of the analysis panel (spec §4.9).
//
// "Changed since a branch" means what a review of the current work would
// show: the difference between the files as they are now on disk, committed
// or not, and the commit where the current work left that branch (their
// "merge base"). Files that git does not track yet are new as a whole.
//
// git is run as a program, without a shell. This module does not use the
// VS Code API, so that the reading of the output of git runs in the unit tests.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { LineRange } from '../shared/messages';

/** The reference that stands for the last commit: the changes since it are the uncommitted ones. */
export const LAST_COMMIT_REFERENCE = 'HEAD';

export interface ChangedFile {
  /** Absolute path of the file. */
  path: string;
  /** The lines of the file, as it is now, that were added or changed. */
  ranges: LineRange[];
}

/** A file of a diff, with its path relative to the root of the repository. */
export interface DiffFile {
  path: string;
  ranges: LineRange[];
}

/** Output of git above this size is refused: a diff of that size is not a review. */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/** The local and remote branches of the repository that contains `folder`. */
export async function listBranches(folder: string): Promise<string[]> {
  const output = await runGit(folder, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  return output.split('\n').filter((name) => name !== '' && !name.endsWith('/HEAD'));
}

/** The lines that changed since `reference` in the repository that contains `folder`. */
export async function listChangedLines(folder: string, reference: string): Promise<ChangedFile[]> {
  const repositoryRoot = (await runGit(folder, ['rev-parse', '--show-toplevel'])).trim();
  const base = reference === LAST_COMMIT_REFERENCE ? reference : (await runGit(folder, ['merge-base', reference, 'HEAD'])).trim();
  // -U0 leaves out the unchanged lines around each change; renames are shown as a new file, so
  // that every line of a moved file counts; the prefixes are forced because a user setting can change them.
  const diffArguments = ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', base, '--'];
  const diffFiles = parseDiff(await runGit(repositoryRoot, diffArguments));
  const untracked = await runGit(repositoryRoot, ['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard']);
  for (const relativePath of untracked.split('\n')) {
    if (relativePath !== '') {
      diffFiles.push({ path: relativePath, ranges: [{ firstLine: 1, lastLine: Number.MAX_SAFE_INTEGER }] });
    }
  }
  return diffFiles.map((file) => ({ path: path.join(repositoryRoot, file.path), ranges: file.ranges }));
}

/**
 * Reads the output of `git diff -U0`: for each file, the lines of its new version that each
 * change covers. A change starts with a line such as `@@ -12,3 +14,2 @@`: three lines from
 * line 12 of the old file became two lines from line 14 of the new one.
 */
export function parseDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      const newPath = readDiffPath(line.slice(4));
      // `+++ /dev/null`: the file was deleted, it has no line any more.
      current = newPath === undefined ? undefined : { path: newPath, ranges: [] };
      if (current !== undefined) {
        files.push(current);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || current === undefined) {
      continue;
    }
    const firstLine = Number(hunk[1]);
    const lineCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (lineCount === 0) {
      current.ranges.push({ firstLine, lastLine: firstLine + 1, deletionOnly: true });
    } else {
      current.ranges.push({ firstLine, lastLine: firstLine + lineCount - 1 });
    }
  }
  return files.filter((file) => file.ranges.length > 0);
}

/** The path of a `+++ b/path` line, or undefined for `/dev/null`. */
function readDiffPath(text: string): string | undefined {
  // git adds a tab after a path that contains spaces, and quotes a path with special characters.
  const withoutTab = text.replace(/\t$/, '').replace(/\r$/, '');
  const unquoted = withoutTab.startsWith('"') && withoutTab.endsWith('"') ? withoutTab.slice(1, -1) : withoutTab;
  return unquoted.startsWith('b/') ? unquoted.slice(2) : undefined;
}

function runGit(folder: string, gitArguments: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', gitArguments, { cwd: folder, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) {
        resolve(stdout);
        return;
      }
      const isGitMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      const reason = isGitMissing ? 'git was not found on this computer.' : stderr.trim() || error.message;
      reject(new Error(reason));
    });
  });
}
