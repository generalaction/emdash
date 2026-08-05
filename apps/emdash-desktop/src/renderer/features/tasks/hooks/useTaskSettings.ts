import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  autoTrustWorktrees: boolean;
  createBranchAndWorktree: boolean;
  deleteBranchByDefault: boolean;
  preserveNameCapitalization: boolean;
  includeIssueContextByDefault: boolean;
  autoCleanupOnPrMerge: 'off' | 'archive' | 'delete';
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (
    field:
      | 'autoGenerateName'
      | 'autoApproveByDefault'
      | 'autoTrustWorktrees'
      | 'createBranchAndWorktree'
      | 'deleteBranchByDefault'
      | 'preserveNameCapitalization'
      | 'includeIssueContextByDefault'
      | 'autoCleanupOnPrMerge'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoApproveByDefault: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateCreateBranchAndWorktree: (next: boolean) => void;
  updateDeleteBranchByDefault: (next: boolean) => void;
  updatePreserveNameCapitalization: (next: boolean) => void;
  updateIncludeIssueContextByDefault: (next: boolean) => void;
  updateAutoCleanupOnPrMerge: (next: 'off' | 'archive' | 'delete') => void;
  resetAutoGenerateName: () => void;
  resetAutoApproveByDefault: () => void;
  resetAutoTrustWorktrees: () => void;
  resetCreateBranchAndWorktree: () => void;
  resetDeleteBranchByDefault: () => void;
  resetPreserveNameCapitalization: () => void;
  resetIncludeIssueContextByDefault: () => void;
  resetAutoCleanupOnPrMerge: () => void;
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
    autoApproveByDefault: tasks?.autoApproveByDefault ?? false,
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? false,
    createBranchAndWorktree: tasks?.createBranchAndWorktree ?? true,
    deleteBranchByDefault: tasks?.deleteBranchByDefault ?? false,
    preserveNameCapitalization: tasks?.preserveNameCapitalization ?? false,
    includeIssueContextByDefault: tasks?.includeIssueContextByDefault ?? true,
    autoCleanupOnPrMerge: tasks?.autoCleanupOnPrMerge ?? 'off',
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoApproveByDefault: (next) => update({ autoApproveByDefault: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateCreateBranchAndWorktree: (next) => update({ createBranchAndWorktree: next }),
    updateDeleteBranchByDefault: (next) => update({ deleteBranchByDefault: next }),
    updatePreserveNameCapitalization: (next) => update({ preserveNameCapitalization: next }),
    updateIncludeIssueContextByDefault: (next) => update({ includeIssueContextByDefault: next }),
    updateAutoCleanupOnPrMerge: (next) => update({ autoCleanupOnPrMerge: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoApproveByDefault: () => resetField('autoApproveByDefault'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetCreateBranchAndWorktree: () => resetField('createBranchAndWorktree'),
    resetDeleteBranchByDefault: () => resetField('deleteBranchByDefault'),
    resetPreserveNameCapitalization: () => resetField('preserveNameCapitalization'),
    resetIncludeIssueContextByDefault: () => resetField('includeIssueContextByDefault'),
    resetAutoCleanupOnPrMerge: () => resetField('autoCleanupOnPrMerge'),
  };
}
