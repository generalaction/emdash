import { describe, expect, it } from 'vitest';
import { getNextTheme } from './theme-toggle-model';

describe('getNextTheme', () => {
  it('toggles explicit light to dark', () => {
    expect(getNextTheme('emlight', false)).toBe('emdark');
  });

  it('toggles explicit dark to light', () => {
    expect(getNextTheme('emdark', true)).toBe('emlight');
  });

  it('uses system light when no explicit theme is selected', () => {
    expect(getNextTheme(null, false)).toBe('emdark');
  });

  it('uses system dark when no explicit theme is selected', () => {
    expect(getNextTheme(null, true)).toBe('emlight');
  });
});
