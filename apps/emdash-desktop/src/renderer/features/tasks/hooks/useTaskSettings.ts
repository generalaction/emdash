import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

type TaskSettingField =
  | 'autoGenerateName'
  | 'autoApproveByDefault'
  | 'autoTrustWorktrees'
  | 'createBranchAndWorktree'
  | 'preserveNameCapitalization'
  | 'includeIssueContextByDefault'
  | 'autoCleanupMergedEnabled'
  | 'autoCleanupMergedAction'
  | 'autoCleanupMergedDeleteBranch'
  | 'autoCleanupMergedDelayMs';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  autoTrustWorktrees: boolean;
  createBranchAndWorktree: boolean;
  preserveNameCapitalization: boolean;
  includeIssueContextByDefault: boolean;
  autoCleanupMergedEnabled: boolean;
  autoCleanupMergedAction: 'archive' | 'delete';
  autoCleanupMergedDeleteBranch: boolean;
  autoCleanupMergedDelayMs: number;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (field: TaskSettingField) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoApproveByDefault: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateCreateBranchAndWorktree: (next: boolean) => void;
  updatePreserveNameCapitalization: (next: boolean) => void;
  updateIncludeIssueContextByDefault: (next: boolean) => void;
  updateAutoCleanupMergedEnabled: (next: boolean) => void;
  updateAutoCleanupMergedAction: (next: 'archive' | 'delete') => void;
  updateAutoCleanupMergedDeleteBranch: (next: boolean) => void;
  updateAutoCleanupMergedDelayMs: (next: number) => void;
  resetAutoGenerateName: () => void;
  resetAutoApproveByDefault: () => void;
  resetAutoTrustWorktrees: () => void;
  resetCreateBranchAndWorktree: () => void;
  resetPreserveNameCapitalization: () => void;
  resetIncludeIssueContextByDefault: () => void;
  resetAutoCleanupMergedEnabled: () => void;
  resetAutoCleanupMergedAction: () => void;
  resetAutoCleanupMergedDeleteBranch: () => void;
  resetAutoCleanupMergedDelayMs: () => void;
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
    preserveNameCapitalization: tasks?.preserveNameCapitalization ?? false,
    includeIssueContextByDefault: tasks?.includeIssueContextByDefault ?? true,
    autoCleanupMergedEnabled: tasks?.autoCleanupMergedEnabled ?? false,
    autoCleanupMergedAction: tasks?.autoCleanupMergedAction ?? 'archive',
    autoCleanupMergedDeleteBranch: tasks?.autoCleanupMergedDeleteBranch ?? false,
    autoCleanupMergedDelayMs: tasks?.autoCleanupMergedDelayMs ?? 24 * 60 * 60 * 1000,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoApproveByDefault: (next) => update({ autoApproveByDefault: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateCreateBranchAndWorktree: (next) => update({ createBranchAndWorktree: next }),
    updatePreserveNameCapitalization: (next) => update({ preserveNameCapitalization: next }),
    updateIncludeIssueContextByDefault: (next) => update({ includeIssueContextByDefault: next }),
    updateAutoCleanupMergedEnabled: (next) => update({ autoCleanupMergedEnabled: next }),
    updateAutoCleanupMergedAction: (next) => update({ autoCleanupMergedAction: next }),
    updateAutoCleanupMergedDeleteBranch: (next) => update({ autoCleanupMergedDeleteBranch: next }),
    updateAutoCleanupMergedDelayMs: (next) => update({ autoCleanupMergedDelayMs: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoApproveByDefault: () => resetField('autoApproveByDefault'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetCreateBranchAndWorktree: () => resetField('createBranchAndWorktree'),
    resetPreserveNameCapitalization: () => resetField('preserveNameCapitalization'),
    resetIncludeIssueContextByDefault: () => resetField('includeIssueContextByDefault'),
    resetAutoCleanupMergedEnabled: () => resetField('autoCleanupMergedEnabled'),
    resetAutoCleanupMergedAction: () => resetField('autoCleanupMergedAction'),
    resetAutoCleanupMergedDeleteBranch: () => resetField('autoCleanupMergedDeleteBranch'),
    resetAutoCleanupMergedDelayMs: () => resetField('autoCleanupMergedDelayMs'),
  };
}
