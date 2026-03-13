import { useAppSettingsKey } from '@renderer/contexts/AppSettingsProvider';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  autoTrustWorktrees: boolean;
  loading: boolean;
  saving: boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoApproveByDefault: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
}

export function useTaskSettings(): TaskSettingsModel {
  const { value: tasks, isLoading: loading, isSaving: saving, update } = useAppSettingsKey('tasks');

  return {
    // Zod schema always provides these values; ?? false is only a loading-state TypeScript guard.
    autoGenerateName: tasks?.autoGenerateName ?? false,
    autoApproveByDefault: tasks?.autoApproveByDefault ?? false,
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? false,
    loading,
    saving,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoApproveByDefault: (next) => update({ autoApproveByDefault: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
  };
}
