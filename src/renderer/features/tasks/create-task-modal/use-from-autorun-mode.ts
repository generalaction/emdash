import { useState } from 'react';
import type { Branch } from '@shared/git';
import type { Issue } from '@shared/tasks';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { useBranchSelection } from './use-branch-selection';

export type FromAutorunModeState = ReturnType<typeof useFromAutorunMode>;

export function useFromAutorunMode(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  currentBranchName?: string | null
) {
  const branchSelection = useBranchSelection(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranchName
  );
  const projectSettings = selectedProjectId
    ? (getProjectSettingsStore(selectedProjectId)?.settings ?? null)
    : null;
  const autorunDefaults = projectSettings?.autorun;

  const [selectedIssues, setSelectedIssues] = useState<Issue[]>([]);
  const [concurrency, setConcurrency] = useState<number>(autorunDefaults?.concurrency ?? 3);
  const [autoCreatePr, setAutoCreatePr] = useState<boolean>(
    autorunDefaults?.defaultCreateDraftPr ?? false
  );
  const [extraPrompt, setExtraPrompt] = useState<string>('');

  const isValid =
    selectedIssues.length > 0 && branchSelection.selectedBranch !== undefined && concurrency >= 1;

  return {
    ...branchSelection,
    selectedIssues,
    setSelectedIssues,
    concurrency,
    setConcurrency,
    autoCreatePr,
    setAutoCreatePr,
    extraPrompt,
    setExtraPrompt,
    isValid,
    /** The modal's submit handler needs a taskName for the InitialConversation header; supply a placeholder. */
    taskName: 'autorun-batch',
    isPending: false as const,
  };
}
