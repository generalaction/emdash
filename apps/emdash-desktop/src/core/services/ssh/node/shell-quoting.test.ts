import { describe, expect, it } from 'vitest';
import { escapeShellArg } from './shell-quoting';

describe('escapeShellArg', () => {
  it('quotes empty and ordinary values', () => {
    expect(escapeShellArg('')).toBe("''");
    expect(escapeShellArg('/home/user/file name')).toBe("'/home/user/file name'");
  });

  it('keeps shell metacharacters and single quotes literal', () => {
    expect(escapeShellArg("a'; rm -rf /; echo '")).toBe("'a'\\''; rm -rf /; echo '\\'''");
  });
});
