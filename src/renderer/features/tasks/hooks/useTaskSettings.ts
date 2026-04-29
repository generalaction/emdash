import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export type TaskSettingsField = 'autoGenerateName' | 'autoTrustWorktrees' | 'keepAwakeWhileRunning';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoTrustWorktrees: boolean;
  keepAwakeWhileRunning: boolean;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (field: TaskSettingsField) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateKeepAwakeWhileRunning: (next: boolean) => void;
  resetAutoGenerateName: () => void;
  resetAutoTrustWorktrees: () => void;
  resetKeepAwakeWhileRunning: () => void;
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
    keepAwakeWhileRunning: tasks?.keepAwakeWhileRunning ?? false,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateKeepAwakeWhileRunning: (next) => update({ keepAwakeWhileRunning: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetKeepAwakeWhileRunning: () => resetField('keepAwakeWhileRunning'),
  };
}
