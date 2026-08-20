import { describe, expect, it } from 'vitest';
import { seedNonEmptyHistory } from './acp-history';

describe('seedNonEmptyHistory', () => {
  it('does not clear an existing transcript when rematerialization returns no turns', () => {
    let transcript = ['existing turn'];

    const seeded = seedNonEmptyHistory<string>([], (turns) => {
      transcript = turns;
    });

    expect(seeded).toBe(false);
    expect(transcript).toEqual(['existing turn']);
  });

  it('replaces the transcript when provider history contains turns', () => {
    let transcript = ['existing turn'];

    const seeded = seedNonEmptyHistory(['replayed turn'], (turns) => {
      transcript = turns;
    });

    expect(seeded).toBe(true);
    expect(transcript).toEqual(['replayed turn']);
  });
});
