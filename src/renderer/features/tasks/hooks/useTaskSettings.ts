import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoTrustWorktrees: boolean;
  autoRenameFromFirstPrompt: boolean;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (
    field: 'autoGenerateName' | 'autoTrustWorktrees' | 'autoRenameFromFirstPrompt'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateAutoRenameFromFirstPrompt: (next: boolean) => void;
  resetAutoGenerateName: () => void;
  resetAutoTrustWorktrees: () => void;
  resetAutoRenameFromFirstPrompt: () => void;
}

export function useTaskSettings(): TaskSettingsModel {
  const {
    value: tasks,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    update,
    resetField,
  } = useAppSettingsKey('tasks');

  return {
    autoGenerateName: tasks?.autoGenerateName ?? false,
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? false,
    autoRenameFromFirstPrompt: tasks?.autoRenameFromFirstPrompt ?? false,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateAutoRenameFromFirstPrompt: (next) => update({ autoRenameFromFirstPrompt: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetAutoRenameFromFirstPrompt: () => resetField('autoRenameFromFirstPrompt'),
  };
}
