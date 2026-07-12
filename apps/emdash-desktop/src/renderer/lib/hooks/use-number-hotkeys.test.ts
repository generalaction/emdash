import { describe, expect, it } from 'vitest';
import { NUMBER_HOTKEY_DEBOUNCE_MS, claimNumberHotkey } from './use-number-hotkeys';

describe('claimNumberHotkey', () => {
  it('debounces each action independently', () => {
    expect(claimNumberHotkey('test:task:1', 1_000)).toBe(true);
    expect(claimNumberHotkey('test:task:2', 1_050)).toBe(true);
    expect(claimNumberHotkey('test:task:1', 1_100)).toBe(false);
  });

  it('allows the same action after the debounce window', () => {
    expect(claimNumberHotkey('test:tab:1', 2_000)).toBe(true);
    expect(claimNumberHotkey('test:tab:1', 2_000 + NUMBER_HOTKEY_DEBOUNCE_MS)).toBe(true);
  });
});
