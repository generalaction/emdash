import { describe, expect, it } from 'vitest';
import { LOG_FORMAT, parseLogRecords } from './log';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

/** Field values in `LOG_FORMAT` order. */
const FIELDS = [
  'a'.repeat(40),
  `${'b'.repeat(40)} ${'c'.repeat(40)}`,
  'feat(replay): require explicit replay-visibility',
  'Portal mounts now opt in.\n\nRefs #1777',
  'Juan Lopez',
  'juan@example.com',
  '1760000000',
  'Release Bot',
  'bot@example.com',
  '1760000600',
  'tag: refs/tags/v2.1.228, refs/heads/main',
];

function buildRecord(fields: readonly string[]): string {
  return `${fields.join(FIELD_SEP)}${RECORD_SEP}`;
}

describe('parseLogRecords', () => {
  it('destructures exactly the placeholders LOG_FORMAT emits', () => {
    expect(LOG_FORMAT.split(FIELD_SEP)).toHaveLength(FIELDS.length);
  });

  it('maps every field to its commit property', () => {
    const [commit] = parseLogRecords(buildRecord(FIELDS), new Set([FIELDS[0]!]));

    expect(commit).toEqual({
      hash: 'a'.repeat(40),
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      subject: 'feat(replay): require explicit replay-visibility',
      body: 'Portal mounts now opt in.\n\nRefs #1777',
      author: 'Juan Lopez',
      authorEmail: 'juan@example.com',
      date: 1_760_000_000_000,
      committer: 'Release Bot',
      committerEmail: 'bot@example.com',
      committerDate: 1_760_000_600_000,
      isPushed: true,
      tags: ['v2.1.228'],
    });
  });

  it('omits the optional identity fields when git emits them empty', () => {
    const fields = [...FIELDS];
    fields[5] = '';
    fields[7] = '';
    fields[8] = '';
    fields[9] = '';

    const [commit] = parseLogRecords(buildRecord(fields), new Set());

    expect(commit?.authorEmail).toBeUndefined();
    expect(commit?.committer).toBeUndefined();
    expect(commit?.committerEmail).toBeUndefined();
    expect(commit?.committerDate).toBeUndefined();
    expect(commit?.author).toBe('Juan Lopez');
  });

  it('reads multiple records and reports unpushed commits', () => {
    const second = [...FIELDS];
    second[0] = 'd'.repeat(40);

    const commits = parseLogRecords(
      `${buildRecord(FIELDS)}${buildRecord(second)}`,
      new Set([FIELDS[0]!])
    );

    expect(commits).toHaveLength(2);
    expect(commits[0]?.isPushed).toBe(true);
    expect(commits[1]?.isPushed).toBe(false);
  });
});
