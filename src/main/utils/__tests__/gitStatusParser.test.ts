import { describe, expect, it } from 'vitest';
import { combineNumstatValues, parseGitStatusOutput, parseNumstatOutput } from '../gitStatusParser';

describe('parseGitStatusOutput', () => {
  it('parses porcelain v2 entries with explicit status mapping', () => {
    const output =
      [
        '1 .D N... 100644 100644 000000 aaaaaaa bbbbbbb deleted.txt',
        '2 R. N... 100644 100644 100644 ccccccc ddddddd R100 new-name.ts',
        'old-name.ts',
        '? untracked.txt',
      ].join('\0') + '\0';

    const entries = parseGitStatusOutput(output);
    expect(entries).toEqual([
      {
        path: 'deleted.txt',
        statusCode: '.D',
        status: 'deleted',
        isStaged: false,
      },
      {
        path: 'new-name.ts',
        oldPath: 'old-name.ts',
        statusCode: 'R.',
        status: 'renamed',
        isStaged: true,
      },
      {
        path: 'untracked.txt',
        statusCode: '??',
        status: 'added',
        isStaged: false,
      },
    ]);
  });

  it('falls back to porcelain v1 parsing', () => {
    const output = [
      ' D deleted.txt',
      'A  added.txt',
      'R  old.ts -> new.ts',
      '?? untracked.ts',
    ].join('\n');

    const entries = parseGitStatusOutput(output);
    expect(entries).toEqual([
      {
        path: 'deleted.txt',
        statusCode: ' D',
        status: 'deleted',
        isStaged: false,
      },
      {
        path: 'added.txt',
        statusCode: 'A ',
        status: 'added',
        isStaged: true,
      },
      {
        path: 'new.ts',
        oldPath: 'old.ts',
        statusCode: 'R ',
        status: 'renamed',
        isStaged: true,
      },
      {
        path: 'untracked.ts',
        statusCode: '??',
        status: 'added',
        isStaged: false,
      },
    ]);
  });
});

describe('parseNumstatOutput', () => {
  it('preserves unknown stats as null and resolves rename paths', () => {
    const map = parseNumstatOutput(
      ['-\t-\tbinary.dat', '10\t2\tsrc/file.ts', '3\t1\tsrc/{old => new}.ts'].join('\n')
    );

    expect(map.get('binary.dat')).toEqual({ additions: null, deletions: null });
    expect(map.get('src/file.ts')).toEqual({ additions: 10, deletions: 2 });
    expect(map.get('src/new.ts')).toEqual({ additions: 3, deletions: 1 });
  });
});

describe('combineNumstatValues', () => {
  it('propagates unknown values', () => {
    expect(combineNumstatValues(3, 2)).toBe(5);
    expect(combineNumstatValues(undefined, 2)).toBe(2);
    expect(combineNumstatValues(3, undefined)).toBe(3);
    expect(combineNumstatValues(null, 2)).toBeNull();
    expect(combineNumstatValues(2, null)).toBeNull();
  });
});
