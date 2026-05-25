import { describe, expect, it } from 'vitest';
import { resolveProjectTmuxEnabled } from '@shared/project-settings';

describe('resolveProjectTmuxEnabled', () => {
  it('uses the project override when set', () => {
    expect(resolveProjectTmuxEnabled({ tmux: false }, true)).toBe(false);
    expect(resolveProjectTmuxEnabled({ tmux: true }, false)).toBe(true);
  });

  it('falls back to the app default when the project setting is unset', () => {
    expect(resolveProjectTmuxEnabled({}, true)).toBe(true);
    expect(resolveProjectTmuxEnabled({}, false)).toBe(false);
  });
});
