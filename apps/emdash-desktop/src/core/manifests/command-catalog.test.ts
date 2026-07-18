import { describe, expect, it } from 'vitest';
import { taskViewScope } from '@core/features/tasks/contributions/scopes';
import {
  ALL_COMMAND_DEFS as LEGACY_COMMAND_DEFS,
  type CommandDef as LegacyCommandDef,
} from '@core/primitives/commands/api/commands';
import {
  APP_SHORTCUTS,
  resolveDefaultHotkey,
  type ShortcutSettingsKey,
} from '@core/primitives/commands/api/shortcuts';
import {
  CODE_TO_US_CHAR,
  codeToChar,
  findConflicts,
  resolveChordSpec,
  tokenKind,
  chordParts,
  type KeyCode,
  type KeybindingEntry,
  type SettingsKeybinding,
} from '@core/primitives/keybindings/api';
import { COMMAND_CATALOG } from './command-catalog';
import { SCOPE_CATALOG, windowScope } from './scope-catalog';

// Inventory pinned during Phase 0:
// - 8 legacy app defs and 24 legacy task defs are transcribed one-for-one.
// - close/confirm are modal dispatch mechanics deferred with modal scopes.
// - tab bindings are deferred until tab/pane scopes exist.
// - terminal search remains ad hoc; APP_SHORTCUTS currently has no entry for it.
const EXCLUDED_SHORTCUT_KEYS = new Set<ShortcutSettingsKey>([
  'closeModal',
  'confirm',
  'tabNext',
  'tabPrev',
  'tabClose',
  'tabReopen',
  'tabRename',
  'splitPane',
]);

function settingsBindings(): Map<string, SettingsKeybinding> {
  return new Map(
    COMMAND_CATALOG.defs.flatMap((command) =>
      command.keybinding?.kind === 'settings'
        ? [[command.keybinding.settingsKey, command.keybinding] as const]
        : []
    )
  );
}

function toLegacyChord(binding: SettingsKeybinding): string {
  const resolved = resolveChordSpec(binding.defaultChord, { os: 'linux' });
  const parts = chordParts(resolved);
  const modifiers = parts.modifiers.map((modifier) => (modifier === '$mod' ? 'Mod' : modifier));
  const key =
    tokenKind(resolved) === 'code'
      ? (codeToChar(CODE_TO_US_CHAR, parts.key as KeyCode) ?? parts.key)
      : parts.key;
  return [...modifiers, key].join('+');
}

function scopeForLegacyCommand(definition: LegacyCommandDef) {
  return definition.scope === 'app' ? windowScope : taskViewScope;
}

describe('COMMAND_CATALOG', () => {
  it('preserves every legacy command id and presentation', () => {
    for (const legacy of LEGACY_COMMAND_DEFS) {
      const current = COMMAND_CATALOG.byId(legacy.id);
      expect(current, legacy.id).toBeDefined();
      expect(current?.title).toBe(legacy.label);
      expect(current?.category).toBe(legacy.group);
    }
  });

  it('preserves scope membership for every legacy command', () => {
    for (const legacy of LEGACY_COMMAND_DEFS) {
      const current = COMMAND_CATALOG.byId(legacy.id);
      expect(scopeForLegacyCommand(legacy).commands, legacy.id).toContain(current);
    }
  });

  it('maps every non-deferred legacy shortcut to one settings keybinding', () => {
    const bindings = settingsBindings();

    for (const [settingsKey, legacy] of Object.entries(APP_SHORTCUTS) as [
      ShortcutSettingsKey,
      (typeof APP_SHORTCUTS)[ShortcutSettingsKey],
    ][]) {
      if (EXCLUDED_SHORTCUT_KEYS.has(settingsKey)) {
        expect(bindings.has(settingsKey), settingsKey).toBe(false);
        continue;
      }

      const binding = bindings.get(settingsKey);
      expect(binding, settingsKey).toBeDefined();
      expect(toLegacyChord(binding as SettingsKeybinding)).toBe(resolveDefaultHotkey(legacy));
      expect(binding?.options?.ignoreWhenTextInputFocused ?? false).toBe(
        Boolean(legacy.ignoreWhenMonacoFocused || legacy.ignoreWhenBrowserFocused)
      );
    }

    for (const settingsKey of bindings.keys()) {
      expect(settingsKey in APP_SHORTCUTS, settingsKey).toBe(true);
    }
  });

  it('keeps settings keys unique', () => {
    const keys = COMMAND_CATALOG.defs.flatMap((command) =>
      command.keybinding?.kind === 'settings' ? [command.keybinding.settingsKey] : []
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('allows undefined input for every keybinding-invocable command', () => {
    for (const command of COMMAND_CATALOG.defs) {
      if (!command.keybinding) continue;
      expect(command.input.safeParse(undefined).success, command.id).toBe(true);
    }
  });

  it('has no same-scope configurable keybinding conflicts under the US layout', () => {
    const groupByCommandId = new Map<string, string>();
    for (const scope of SCOPE_CATALOG) {
      for (const command of scope.commands) {
        groupByCommandId.set(command.id, scope.id);
      }
    }
    const entries: KeybindingEntry[] = COMMAND_CATALOG.defs.flatMap((command) =>
      command.keybinding
        ? [
            {
              id: command.id,
              group: groupByCommandId.get(command.id),
              binding: command.keybinding,
            },
          ]
        : []
    );

    for (const entry of entries) {
      const chord =
        entry.binding.kind === 'fixed'
          ? resolveChordSpec(entry.binding.chord, { os: 'linux' })
          : resolveChordSpec(entry.binding.defaultChord, { os: 'linux' });
      const errors = findConflicts(
        entries,
        chord,
        entry.id,
        {},
        { os: 'linux' },
        CODE_TO_US_CHAR
      ).filter((conflict) => conflict.severity === 'error');
      expect(errors, entry.id).toEqual([]);
    }
  });
});
