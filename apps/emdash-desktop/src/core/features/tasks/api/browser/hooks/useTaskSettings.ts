import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoNameWithAgent: boolean;
  autoTrustWorktrees: boolean;
  createBranchAndWorktree: boolean;
  deleteBranchByDefault: boolean;
  preserveNameCapitalization: boolean;
  includeIssueContextByDefault: boolean;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (
    field:
      | 'autoGenerateName'
      | 'autoNameWithAgent'
      | 'autoTrustWorktrees'
      | 'createBranchAndWorktree'
      | 'deleteBranchByDefault'
      | 'preserveNameCapitalization'
      | 'includeIssueContextByDefault'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoNameWithAgent: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateCreateBranchAndWorktree: (next: boolean) => void;
  updateDeleteBranchByDefault: (next: boolean) => void;
  updatePreserveNameCapitalization: (next: boolean) => void;
  updateIncludeIssueContextByDefault: (next: boolean) => void;
  resetAutoGenerateName: () => void;
  resetAutoNameWithAgent: () => void;
  resetAutoTrustWorktrees: () => void;
  resetCreateBranchAndWorktree: () => void;
  resetDeleteBranchByDefault: () => void;
  resetPreserveNameCapitalization: () => void;
  resetIncludeIssueContextByDefault: () => void;
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
    autoNameWithAgent: tasks?.autoNameWithAgent ?? true,
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? false,
    createBranchAndWorktree: tasks?.createBranchAndWorktree ?? true,
    deleteBranchByDefault: tasks?.deleteBranchByDefault ?? false,
    preserveNameCapitalization: tasks?.preserveNameCapitalization ?? false,
    includeIssueContextByDefault: tasks?.includeIssueContextByDefault ?? true,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoNameWithAgent: (next) => update({ autoNameWithAgent: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateCreateBranchAndWorktree: (next) => update({ createBranchAndWorktree: next }),
    updateDeleteBranchByDefault: (next) => update({ deleteBranchByDefault: next }),
    updatePreserveNameCapitalization: (next) => update({ preserveNameCapitalization: next }),
    updateIncludeIssueContextByDefault: (next) => update({ includeIssueContextByDefault: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoNameWithAgent: () => resetField('autoNameWithAgent'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetCreateBranchAndWorktree: () => resetField('createBranchAndWorktree'),
    resetDeleteBranchByDefault: () => resetField('deleteBranchByDefault'),
    resetPreserveNameCapitalization: () => resetField('preserveNameCapitalization'),
    resetIncludeIssueContextByDefault: () => resetField('includeIssueContextByDefault'),
  };
}
