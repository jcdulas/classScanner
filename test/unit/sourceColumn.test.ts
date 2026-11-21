// Tests of the choice of the editor column in which a diagram opens files (src/extension/sourceColumn.ts).

import { describe, expect, it } from 'vitest';
import { chooseSourceColumn } from '../../src/extension/sourceColumn';

describe('chooseSourceColumn', () => {
  it('creates a column on the right of a diagram that is alone', () => {
    expect(chooseSourceColumn(1, [1])).toBe(2);
  });

  it('uses the column on the right of the diagram when there is one', () => {
    expect(chooseSourceColumn(1, [1, 2])).toBe(2);
    expect(chooseSourceColumn(2, [1, 2, 3])).toBe(3);
  });

  it('uses the column on the left of the diagram instead of creating a third one', () => {
    expect(chooseSourceColumn(2, [1, 2])).toBe(1);
    expect(chooseSourceColumn(3, [1, 2, 3])).toBe(2);
  });
});
