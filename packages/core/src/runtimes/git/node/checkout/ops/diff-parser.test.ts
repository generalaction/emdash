import { describe, expect, it } from 'vitest';
import { parseNameStatus, parseNumstat } from './diff-parser';

describe('NUL-delimited diff output', () => {
  it('preserves special characters and surrounding whitespace in paths', () => {
    const filePath = ' café\tline\n"quoted"\\{old => new}.txt ';
    expect(parseNumstat(`2\t1\t${filePath}\0`)).toEqual(
      new Map([[filePath, { additions: 2, deletions: 1 }]])
    );
    expect(parseNameStatus(`M\0${filePath}\0`)).toEqual([[filePath, 'modified']]);
  });

  it('consumes both paths of renames and copies before reading the next record', () => {
    const renamedPath = 'new\tname\n.txt';
    const copiedPath = ' copied {a => b}.txt ';
    const numstat = [
      '1\t2\t',
      'old\tname\n.txt',
      renamedPath,
      '3\t4\t',
      'source.txt',
      copiedPath,
      '0\t5\tdeleted.txt',
      '6\t0\tadded.txt',
      '',
    ].join('\0');
    const nameStatus = [
      'R075',
      'old\tname\n.txt',
      renamedPath,
      'C080',
      'source.txt',
      copiedPath,
      'D',
      'deleted.txt',
      'A',
      'added.txt',
      '',
    ].join('\0');

    expect(parseNumstat(numstat)).toEqual(
      new Map([
        [renamedPath, { additions: 1, deletions: 2 }],
        [copiedPath, { additions: 3, deletions: 4 }],
        ['deleted.txt', { additions: 0, deletions: 5 }],
        ['added.txt', { additions: 6, deletions: 0 }],
      ])
    );
    expect(parseNameStatus(nameStatus)).toEqual([
      [renamedPath, 'renamed'],
      [copiedPath, 'modified'],
      ['deleted.txt', 'deleted'],
      ['added.txt', 'added'],
    ]);
  });

  it('keeps binary files with zero line counts', () => {
    expect(parseNumstat('-\t-\tbinary\tfile.bin\0')).toEqual(
      new Map([['binary\tfile.bin', { additions: 0, deletions: 0 }]])
    );
  });

  it('accumulates multiple numstat records for the same path', () => {
    expect(parseNumstat('1\t2\tfile.txt\0' + '3\t4\tfile.txt\0')).toEqual(
      new Map([['file.txt', { additions: 4, deletions: 6 }]])
    );
  });

  it('preserves multiple status records for an unmerged path', () => {
    expect(parseNameStatus('U\0file.txt\0M\0file.txt\0')).toEqual([
      ['file.txt', 'conflicted'],
      ['file.txt', 'modified'],
    ]);
  });

  it('returns no entries for an empty diff', () => {
    expect(parseNumstat('')).toEqual(new Map());
    expect(parseNameStatus('')).toEqual([]);
  });
});
