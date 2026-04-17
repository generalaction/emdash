import { describe, expect, it } from 'vitest';
import {
  getAgentTabSelectionIndex,
  normalizeShortcutKey,
  hasShortcutConflict,
  APP_SHORTCUTS,
} from '../../renderer/hooks/useKeyboardShortcuts';
import { READLINE_SHORTCUTS, PROVIDERS, getProvider } from '../../shared/providers/registry';

describe('normalizeShortcutKey', () => {
  it('normalizes { to [ (Ctrl+Shift+[ produces { on some keyboards)', () => {
    expect(normalizeShortcutKey('{')).toBe('[');
  });

  it('normalizes } to ] (Ctrl+Shift+] produces } on some keyboards)', () => {
    expect(normalizeShortcutKey('}')).toBe(']');
  });

  it('normalizes single characters to lowercase', () => {
    expect(normalizeShortcutKey('E')).toBe('e');
    expect(normalizeShortcutKey('K')).toBe('k');
  });

  it('normalizes special key aliases', () => {
    expect(normalizeShortcutKey('Esc')).toBe('Escape');
    expect(normalizeShortcutKey('esc')).toBe('Escape');
    expect(normalizeShortcutKey('left')).toBe('ArrowLeft');
    expect(normalizeShortcutKey('right')).toBe('ArrowRight');
  });
});

describe('READLINE_SHORTCUTS — conflicts with Emdash app shortcuts on Linux/Windows', () => {
  it('contains exactly the 7 expected readline keys', () => {
    expect(READLINE_SHORTCUTS).toHaveLength(7);
    expect(READLINE_SHORTCUTS).toEqual(expect.arrayContaining(['e', 'k', 'n', 'p', 'b', 'o', 't']));
  });

  it('every readline key conflicts with a cmd-modifier app shortcut', () => {
    // On Linux/Windows cmd=Ctrl, so Ctrl+E etc. would fire app shortcuts
    // without the reserved-shortcuts fix
    const cmdShortcutKeys = Object.values(APP_SHORTCUTS)
      .filter((s) => s.modifier === 'cmd')
      .map((s) => normalizeShortcutKey(s.key));

    for (const key of READLINE_SHORTCUTS) {
      expect(cmdShortcutKeys).toContain(key);
    }
  });

  it('the ] and [ keys (Next/Prev Task & Agent) are NOT in READLINE_SHORTCUTS', () => {
    // These should always fire as Emdash shortcuts even when CLI is focused
    expect(READLINE_SHORTCUTS).not.toContain(']');
    expect(READLINE_SHORTCUTS).not.toContain('[');
  });
});

describe('Provider reservedShortcuts', () => {
  it('every provider has reservedShortcuts defined', () => {
    for (const provider of PROVIDERS) {
      expect(
        provider.reservedShortcuts,
        `${provider.name} is missing reservedShortcuts`
      ).toBeDefined();
    }
  });

  it('every provider reserves all READLINE_SHORTCUTS', () => {
    for (const provider of PROVIDERS) {
      for (const key of READLINE_SHORTCUTS) {
        expect(
          provider.reservedShortcuts,
          `${provider.name} is missing reserved key '${key}'`
        ).toContain(key);
      }
    }
  });

  it('GitHub Copilot reserves all READLINE_SHORTCUTS', () => {
    const copilot = getProvider('copilot');
    expect(copilot).toBeDefined();
    expect(copilot?.reservedShortcuts).toEqual(expect.arrayContaining(READLINE_SHORTCUTS));
  });
});

describe('hasShortcutConflict', () => {
  const sc = (key: string, modifier: 'cmd' | 'ctrl' | 'cmd+shift' = 'cmd') => ({
    key,
    modifier,
    description: '',
  });

  it('detects conflict when key and modifier both match', () => {
    expect(hasShortcutConflict(sc('e'), sc('e'))).toBe(true);
  });

  it('no conflict when modifier differs', () => {
    expect(hasShortcutConflict(sc('e', 'cmd'), sc('e', 'ctrl'))).toBe(false);
  });

  it('no conflict when key differs', () => {
    expect(hasShortcutConflict(sc('e'), sc('k'))).toBe(false);
  });

  it('normalizes keys before comparing (e vs E)', () => {
    expect(hasShortcutConflict(sc('E'), sc('e'))).toBe(true);
  });

  it('normalizes { and } before comparing', () => {
    // } normalizes to ] — used for Next/Prev Agent on keyboards that produce curly braces
    expect(hasShortcutConflict(sc('}', 'cmd+shift'), sc(']', 'cmd+shift'))).toBe(true);
    expect(hasShortcutConflict(sc('{', 'cmd+shift'), sc('[', 'cmd+shift'))).toBe(true);
  });
});

describe('getAgentTabSelectionIndex', () => {
  it('maps Cmd/Ctrl+1 through Cmd/Ctrl+9 to zero-based tab indexes', () => {
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
        key: '9',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBe(8);
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
