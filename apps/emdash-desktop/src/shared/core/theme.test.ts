import { describe, expect, it } from 'vitest';
import { resolveEffectiveTheme } from './theme';

describe('resolveEffectiveTheme', () => {
  it('uses explicit app themes', () => {
    expect(resolveEffectiveTheme('emlight', true)).toBe('emlight');
    expect(resolveEffectiveTheme('emdark', false)).toBe('emdark');
  });

  it('follows system colors when app theme is system', () => {
    expect(resolveEffectiveTheme(null, true)).toBe('emdark');
    expect(resolveEffectiveTheme(null, false)).toBe('emlight');
  });
});
