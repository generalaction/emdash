import { describe, expect, it } from 'vitest';
import { getElectronThemeSource, getWindowBackgroundColor } from './window-theme';

describe('window-theme', () => {
  it('uses the explicit light theme', () => {
    expect(getWindowBackgroundColor('emlight', true)).toBe('#ffffff');
    expect(getElectronThemeSource('emlight')).toBe('light');
  });

  it('uses the explicit dark theme', () => {
    expect(getWindowBackgroundColor('emdark', false)).toBe('#111111');
    expect(getElectronThemeSource('emdark')).toBe('dark');
  });

  it('follows system dark colors when theme is system', () => {
    expect(getWindowBackgroundColor(null, true)).toBe('#111111');
    expect(getElectronThemeSource(null)).toBe('system');
  });

  it('follows system light colors when theme is system', () => {
    expect(getWindowBackgroundColor(null, false)).toBe('#ffffff');
  });
});
