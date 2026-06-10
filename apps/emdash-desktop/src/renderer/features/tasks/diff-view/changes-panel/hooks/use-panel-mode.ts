import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import type { ChangesPanelMode } from '@shared/core/app-settings';

export function usePanelMode() {
  const { value, update } = useAppSettingsKey('changesPanelMode');
  const mode: ChangesPanelMode = value ?? 'split';
  const setMode = (next: ChangesPanelMode) => update(next as never);
  return { mode, setMode };
}
