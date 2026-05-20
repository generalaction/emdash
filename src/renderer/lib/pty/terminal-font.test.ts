import { describe, expect, it } from 'vitest';
import { buildTerminalFontFamily } from './terminal-font';

describe('buildTerminalFontFamily', () => {
  it('quotes font family names that contain spaces', () => {
    expect(buildTerminalFontFamily('SF Mono')).toBe(
      '"SF Mono", "Menlo", "Monaco", "Consolas", monospace'
    );
  });

  it('escapes quotes in custom font names', () => {
    expect(buildTerminalFontFamily('Font "Name"')).toBe(
      '"Font \\"Name\\"", "Menlo", "Monaco", "Consolas", monospace'
    );
  });

  it('keeps generic font families unquoted', () => {
    expect(buildTerminalFontFamily('monospace')).toBe('monospace, "Menlo", "Monaco", "Consolas"');
  });

  it('uses terminal-safe fallbacks when no custom font is set', () => {
    expect(buildTerminalFontFamily()).toBe('"Menlo", "Monaco", "Consolas", monospace');
  });
});
