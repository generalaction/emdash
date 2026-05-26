import { describe, expect, it } from 'vitest';
import { isUnexpectedPtyExit } from './exit-classification';

describe('isUnexpectedPtyExit', () => {
  it('treats a zero exit code without signal as expected', () => {
    expect(isUnexpectedPtyExit({ exitCode: 0 })).toBe(false);
  });

  it('treats non-zero exit codes as unexpected', () => {
    expect(isUnexpectedPtyExit({ exitCode: 1 })).toBe(true);
  });

  it('treats signal exits as unexpected even when exitCode is zero', () => {
    expect(isUnexpectedPtyExit({ exitCode: 0, signal: 'SIGTERM' })).toBe(true);
  });

  it('treats missing exit status as unexpected', () => {
    expect(isUnexpectedPtyExit({})).toBe(true);
  });
});
