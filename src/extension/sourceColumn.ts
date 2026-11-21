// Chooses the editor column in which the diagram opens source files (spec §4.6).
//
// Every file opened from a diagram goes to one column, so that the code is
// always read in the same place:
//   - the column on the right of the diagram, when there is one;
//   - otherwise the column on its left, when there is one: a third column is
//     not created while a column that can show code already exists;
//   - otherwise a new column on the right of the diagram.
//
// Columns are numbered from 1, in the order of the editor groups of the
// window. This module does not use the VS Code API, so that it runs in tests.

export function chooseSourceColumn(diagramColumn: number, existingColumns: number[]): number {
  const rightColumn = diagramColumn + 1;
  const leftColumn = diagramColumn - 1;
  if (existingColumns.includes(rightColumn)) {
    return rightColumn;
  }
  if (existingColumns.includes(leftColumn)) {
    return leftColumn;
  }
  // This column does not exist yet: VS Code creates it when a file is shown in it.
  return rightColumn;
}
