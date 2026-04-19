import { describe, expect, it } from 'vitest';
import { getAgentTabSelectionIndex } from '../../renderer/hooks/useKeyboardShortcuts';

describe('getAgentTabSelectionIndex', () => {
  it('maps Cmd/Ctrl+1 through Cmd/Ctrl+8 to zero-based tab indexes', () => {
    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBe(0);

    expect(
      getAgentTabSelectionIndex({
        key: '8',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBe(7);
  });

  it('maps Cmd/Ctrl+9 to -1 (last-tab sentinel)', () => {
    expect(
      getAgentTabSelectionIndex({
        key: '9',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBe(-1);
  });

  it('accepts Ctrl+number as the Command equivalent on non-mac platforms', () => {
    expect(
      getAgentTabSelectionIndex(
        {
          key: '4',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBe(3);
  });

  it('ignores keys outside 1-9 and modified variants', () => {
    expect(
      getAgentTabSelectionIndex({
        key: '0',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      } as KeyboardEvent)
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBeNull();
  });
});
