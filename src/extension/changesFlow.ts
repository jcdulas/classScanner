// Asks the user since which git reference the changes of the sources are
// wanted (spec §4.9): the last commit, or a branch of the repository.

import * as vscode from 'vscode';
import { LAST_COMMIT_REFERENCE, listBranches } from './gitChanges';

/** Branches that a work branch usually starts from: they are listed first. */
const USUAL_BASE_BRANCHES = ['main', 'master', 'develop', 'origin/main', 'origin/master', 'origin/develop'];

/** Returns the chosen reference, or undefined when the user closed the list. Fails when `folder` is not in a git repository. */
export async function askChangeReference(folder: string): Promise<string | undefined> {
  const branches = await listBranches(folder);
  const rankOf = (branch: string) => {
    const rank = USUAL_BASE_BRANCHES.indexOf(branch);
    return rank < 0 ? USUAL_BASE_BRANCHES.length : rank;
  };
  branches.sort((first, second) => rankOf(first) - rankOf(second) || first.localeCompare(second));

  const choices: (vscode.QuickPickItem & { reference: string })[] = [
    { label: 'Uncommitted changes', description: 'since the last commit', reference: LAST_COMMIT_REFERENCE },
    ...branches.map((branch) => ({ label: branch, description: 'since the current work left this branch', reference: branch })),
  ];
  const choice = await vscode.window.showQuickPick(choices, { title: 'Show the classes changed since', matchOnDescription: true });
  return choice?.reference;
}
