import { describe, expect, it } from 'vitest';
import { quotePathForShell } from './open-in-shell';

describe('quotePathForShell', () => {
  it('uses Windows-compatible quotes for paths with spaces', () => {
    expect(quotePathForShell('C:\\Git Repositories\\Emdash\\test-project', 'win32')).toBe(
      '"C:\\Git Repositories\\Emdash\\test-project"'
    );
  });

  it('uses POSIX single-quote escaping on Unix platforms', () => {
    expect(quotePathForShell("/Users/me/Git Repositories/it's fine", 'darwin')).toBe(
      "'/Users/me/Git Repositories/it'\\''s fine'"
    );
  });
});
