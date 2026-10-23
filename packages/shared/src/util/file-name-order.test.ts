import { describe, expect, it } from 'vitest';
import { compareFileNames } from './file-name-order';

describe('compareFileNames', () => {
  it('orders names naturally and case-insensitively', () => {
    expect(['file10.ts', 'File2.ts', 'file1.ts', 'b.ts', 'A.ts'].sort(compareFileNames)).toEqual([
      'A.ts',
      'b.ts',
      'file1.ts',
      'File2.ts',
      'file10.ts',
    ]);
  });

  it('breaks collation ties deterministically', () => {
    expect(['a', 'A'].sort(compareFileNames)).toEqual(['A', 'a']);
    expect(['A', 'a'].sort(compareFileNames)).toEqual(['A', 'a']);
    expect(compareFileNames('same', 'same')).toBe(0);
  });
});
