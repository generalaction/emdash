import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getFamilyRevealModifier, useModifierHeld } from '@renderer/lib/hooks/use-modifier-held';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { TASK_BY_NUMBER_KEYS } from '@shared/shortcuts';

export const taskHintKey = (projectId: string, taskId: string) => `${projectId} ${taskId}`;

/**
 * While the task-jump modifier (default Cmd on macOS) is held, maps
 * `taskHintKey(projectId, taskId)` of the first 9 numberedTaskEntries to the
 * hotkey that jumps to them (each digit's own effective binding). Null while
 * hidden. Call from observer components.
 */
export function useTaskNumberHints(): ReadonlyMap<string, string> | null {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const held = useModifierHeld(getFamilyRevealModifier(TASK_BY_NUMBER_KEYS, keyboard));
  if (!held) return null;
  const entries = sidebarStore.numberedTaskEntries.slice(0, TASK_BY_NUMBER_KEYS.length);
  const hints = new Map<string, string>();
  entries.forEach((entry, i) => {
    const hotkey = getEffectiveHotkey(TASK_BY_NUMBER_KEYS[i], keyboard);
    if (hotkey !== null) hints.set(taskHintKey(entry.projectId, entry.taskId), hotkey);
  });
  return hints;
}
