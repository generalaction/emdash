import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoTrustWorktrees: boolean;
  createBranchAndWorktree: boolean;
  preserveNameCapitalization: boolean;
  includeIssueContextByDefault: boolean;
  archiveOnMerge: boolean;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (
    field:
      | 'autoGenerateName'
      | 'autoTrustWorktrees'
      | 'createBranchAndWorktree'
      | 'preserveNameCapitalization'
      | 'includeIssueContextByDefault'
      | 'archiveOnMerge'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  updateCreateBranchAndWorktree: (next: boolean) => void;
  updatePreserveNameCapitalization: (next: boolean) => void;
  updateIncludeIssueContextByDefault: (next: boolean) => void;
  updateArchiveOnMerge: (next: boolean) => void;
  resetAutoGenerateName: () => void;
  resetAutoTrustWorktrees: () => void;
  resetCreateBranchAndWorktree: () => void;
  resetPreserveNameCapitalization: () => void;
  resetIncludeIssueContextByDefault: () => void;
  resetArchiveOnMerge: () => void;
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
    createBranchAndWorktree: tasks?.createBranchAndWorktree ?? true,
    preserveNameCapitalization: tasks?.preserveNameCapitalization ?? false,
    includeIssueContextByDefault: tasks?.includeIssueContextByDefault ?? true,
    archiveOnMerge: tasks?.archiveOnMerge ?? false,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    updateCreateBranchAndWorktree: (next) => update({ createBranchAndWorktree: next }),
    updatePreserveNameCapitalization: (next) => update({ preserveNameCapitalization: next }),
    updateIncludeIssueContextByDefault: (next) => update({ includeIssueContextByDefault: next }),
    updateArchiveOnMerge: (next) => update({ archiveOnMerge: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
    resetCreateBranchAndWorktree: () => resetField('createBranchAndWorktree'),
    resetPreserveNameCapitalization: () => resetField('preserveNameCapitalization'),
    resetIncludeIssueContextByDefault: () => resetField('includeIssueContextByDefault'),
    resetArchiveOnMerge: () => resetField('archiveOnMerge'),
  };
}
