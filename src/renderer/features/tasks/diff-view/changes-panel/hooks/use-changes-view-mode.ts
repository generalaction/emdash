import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import type { ChangesListViewMode, ChangesSection } from '@shared/core/app-settings';

export function useChangesViewMode(section: ChangesSection) {
  const { value, update } = useAppSettingsKey('changesViewMode');
  const mode: ChangesListViewMode = value?.[section] ?? 'flat';
  const setMode = (next: ChangesListViewMode) => update({ [section]: next });
  return { mode, setMode };
}
