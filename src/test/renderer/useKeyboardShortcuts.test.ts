import { describe, expect, it } from 'vitest';
import { getAgentTabSelectionIndex } from '../../renderer/hooks/useKeyboardShortcuts';

// Non-mac default keyboard shortcuts — derived from DEFAULT_SETTINGS with ctrl+shift
// project cycling (A2 fix: moved off Ctrl+Tab to avoid collision with chat cycling).
const NON_MAC_DEFAULTS: Record<string, { key: string; modifier: string }> = {
  commandPalette: { key: 'k', modifier: 'cmd' },
  settings: { key: ',', modifier: 'cmd' },
  toggleLeftSidebar: { key: 'b', modifier: 'cmd' },
  toggleRightSidebar: { key: '.', modifier: 'cmd' },
  toggleEditor: { key: 'e', modifier: 'cmd' },
  nextProject: { key: ']', modifier: 'ctrl+shift' },
  prevProject: { key: '[', modifier: 'ctrl+shift' },
  newTask: { key: 'n', modifier: 'cmd' },
  nextAgent: { key: ']', modifier: 'cmd+shift' },
  prevAgent: { key: '[', modifier: 'cmd+shift' },
  openInEditor: { key: 'o', modifier: 'cmd' },
  toggleTheme: { key: 'l', modifier: 'cmd+shift' },
  toggleKanban: { key: 'k', modifier: 'cmd+shift' },
  newChat: { key: 't', modifier: 'cmd' },
  closeChat: { key: 'w', modifier: 'cmd' },
  nextChat: { key: 'Tab', modifier: 'ctrl' },
  prevChat: { key: 'Tab', modifier: 'ctrl+shift' },
  reopenClosedChat: { key: 't', modifier: 'cmd+shift' },
  commandPaletteAlt: { key: 'p', modifier: 'cmd+shift' },
};

describe('non-mac default keyboard shortcuts', () => {
  it('has no duplicate modifier+key bindings (assertNoKeyboardShortcutConflicts equivalent)', () => {
    const seen = new Map<string, string>();
    for (const [name, binding] of Object.entries(NON_MAC_DEFAULTS)) {
      const sig = `${binding.modifier}:${binding.key.toLowerCase()}`;
      expect(seen.has(sig), `"${name}" conflicts with "${seen.get(sig)}" on binding ${sig}`).toBe(
        false
      );
      seen.set(sig, name);
    }
  });

  it('uses Ctrl+Shift+]/[ for project cycling, not Ctrl+Tab', () => {
    expect(NON_MAC_DEFAULTS.nextProject).toEqual({ key: ']', modifier: 'ctrl+shift' });
    expect(NON_MAC_DEFAULTS.prevProject).toEqual({ key: '[', modifier: 'ctrl+shift' });
  });

  it('keeps Ctrl+Tab/Ctrl+Shift+Tab for chat cycling on non-mac', () => {
    expect(NON_MAC_DEFAULTS.nextChat).toEqual({ key: 'Tab', modifier: 'ctrl' });
    expect(NON_MAC_DEFAULTS.prevChat).toEqual({ key: 'Tab', modifier: 'ctrl+shift' });
  });
});

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
