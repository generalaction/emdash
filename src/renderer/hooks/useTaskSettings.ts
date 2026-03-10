import { useAppSettings } from '@/contexts/AppSettingsProvider';

export type TaskSettingsErrorScope =
  | 'autoGenerateName'
  | 'autoApproveByDefault'
  | 'createWorktreeByDefault'
  | 'autoTrustWorktrees'
  | 'load'
  | null;

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  createWorktreeByDefault: boolean;
  autoTrustWorktrees: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  errorScope: TaskSettingsErrorScope;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoApproveByDefault: (next: boolean) => void;
  updateCreateWorktreeByDefault: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
}

export function useTaskSettings(): TaskSettingsModel {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();
  const tasks = settings?.tasks;
  return {
    autoGenerateName: tasks?.autoGenerateName ?? true,
    autoApproveByDefault: tasks?.autoApproveByDefault ?? false,
    createWorktreeByDefault: tasks?.createWorktreeByDefault ?? true,
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? true,
    loading,
    saving,
    error: null,
    errorScope: null,
    updateAutoGenerateName: (next) => updateSettings({ tasks: { autoGenerateName: next } }),
    updateAutoApproveByDefault: (next) => updateSettings({ tasks: { autoApproveByDefault: next } }),
    updateCreateWorktreeByDefault: (next) =>
      updateSettings({ tasks: { createWorktreeByDefault: next } }),
    updateAutoTrustWorktrees: (next) => updateSettings({ tasks: { autoTrustWorktrees: next } }),
  };
}
