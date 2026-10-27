import { describe, expect, it } from 'vitest';
import { parsePromotionJournal, serializePromotionJournal } from './promotion-journal.ts';

const identity = {
  tag: 'v1.2.3',
  runId: '1234',
  sha: '0123456789abcdef0123456789abcdef01234567',
};
const keys = ['v1-stable.yml', 'v1-stable-mac.yml'];

describe('promotion journal', () => {
  it('round-trips existing and initially absent roots', () => {
    const snapshot = new Map<string, string | null>([
      ['v1-stable.yml', 'old-win'],
      ['v1-stable-mac.yml', null],
    ]);

    const journal = serializePromotionJournal(identity, snapshot, keys);

    expect(parsePromotionJournal(journal, identity, keys)).toEqual(snapshot);
  });

  it('rejects a journal from another run or with a different root set', () => {
    const journal = serializePromotionJournal(
      identity,
      new Map([
        ['v1-stable.yml', 'old-win'],
        ['v1-stable-mac.yml', 'old-mac'],
      ]),
      keys
    );

    expect(() => parsePromotionJournal(journal, { ...identity, runId: '9999' }, keys)).toThrow(
      'different release run'
    );
    expect(() => parsePromotionJournal(journal, identity, ['v1-stable.yml'])).toThrow(
      'root set mismatch'
    );
  });
});
