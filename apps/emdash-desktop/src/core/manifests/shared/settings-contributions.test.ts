import { describe, expect, it } from 'vitest';
import { appSettingsContributions } from './settings-contributions';

describe('settings contribution manifest', () => {
  it('registers every contribution under its declared key', () => {
    for (const [key, contribution] of Object.entries(appSettingsContributions)) {
      expect(contribution.key).toBe(key);
    }
  });
});
