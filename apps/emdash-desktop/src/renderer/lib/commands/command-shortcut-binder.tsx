import { useHotkey } from '@tanstack/react-hotkeys';
import { observer } from 'mobx-react-lite';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  getHotkeyRegistration,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { commandRegistry } from './registry';

/**
 * Registers one useHotkey for a single shortcut key and delegates to
 * commandRegistry.dispatch(). Mounted/unmounted by CommandShortcutBinder
 * as commands come and go from the registry.
 */
function SingleKeyBinder({ shortcutKey }: { shortcutKey: ShortcutSettingsKey }) {
  const { value: keyboard } = useAppSettingsKey('keyboard');

  useHotkey(
    getHotkeyRegistration(shortcutKey, keyboard),
    () => {
      commandRegistry.dispatch(shortcutKey);
    },
    {
      enabled: getEffectiveHotkey(shortcutKey, keyboard) !== null,
    }
  );

  return null;
}

/**
 * Derives the active shortcut key set directly from commandRegistry.activeCommands.
 * As providers are registered/unregistered (e.g. on navigation), the observer
 * re-renders and mounts/unmounts SingleKeyBinder components accordingly.
 *
 * No scope field needed on APP_SHORTCUTS — the registry is the source of truth
 * for which keys are currently bound. When app-level commands are migrated to
 * the registry, they will automatically get bindings here, at which point they
 * can be removed from AppKeyboardShortcuts.
 */
export const CommandShortcutBinder = observer(function CommandShortcutBinder() {
  const keys = [
    ...new Set(
      commandRegistry.activeCommands
        .filter((c) => c.shortcutKey != null && c.shortcutKey in APP_SHORTCUTS)
        .filter((c) => APP_SHORTCUTS[c.shortcutKey!].conflictBehavior !== 'allow')
        .map((c) => c.shortcutKey!)
    ),
  ];

  return (
    <>
      {keys.map((k) => (
        <SingleKeyBinder key={k} shortcutKey={k} />
      ))}
    </>
  );
});
