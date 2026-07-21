import { describe, expect, it } from 'vitest';
import { buildTerminalFontFamily } from './terminal-font';

describe('buildTerminalFontFamily', () => {
  it('quotes font family names that contain spaces', () => {
    expect(buildTerminalFontFamily('SF Mono')).toBe(
      '"SF Mono", ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace'
    );
  });

  it('escapes quotes in custom font names', () => {
    expect(buildTerminalFontFamily('Font "Name"')).toBe(
      '"Font \\"Name\\"", ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace'
    );
  });

  it('preserves comma-separated custom font family lists', () => {
    expect(buildTerminalFontFamily('SF Mono, Menlo, Monaco')).toBe(
      '"SF Mono", "Menlo", "Monaco", ui-monospace, "SFMono-Regular", "Consolas", "Liberation Mono", "Courier New", monospace'
    );
  });

  it('does not treat quoted CSS lists as a single quoted font name', () => {
    expect(buildTerminalFontFamily('"SF Mono", "Menlo"')).toBe(
      '"SF Mono", "Menlo", ui-monospace, "SFMono-Regular", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace'
    );
  });

  it('keeps generic font families unquoted', () => {
    expect(buildTerminalFontFamily('monospace')).toBe(
      'monospace, ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New"'
    );
  });

  it('uses terminal-safe fallbacks when no custom font is set', () => {
    expect(buildTerminalFontFamily()).toBe(
      'ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace'
    );
  });
});
