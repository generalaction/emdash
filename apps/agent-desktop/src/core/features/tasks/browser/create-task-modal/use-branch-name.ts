import { useCallback, useMemo, useState } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { issueMentionToken } from '@core/primitives/issues/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { resolveTaskBranchName } from '@core/primitives/tasks/api';

export type BranchNameState = {
  branchName: string;
  setBranchName: (value: string) => void;
  isUserModified: boolean;
  branchAlreadyExists: boolean;
};

export function useBranchName(opts: {
  taskName: string;
  linkedIssue?: LinkedIssue | null;
  projectId?: string;
  resetKey?: unknown;
}): BranchNameState {
  const { taskName, linkedIssue, projectId, resetKey } = opts;

  const { value: project } = useAppSettingsKey('project');
  const branchPrefix = project?.branchPrefix ?? '';
  const appendRandomSuffix = project?.appendRandomBranchSuffix ?? true;

  // Generate random suffix once per modal session.
  const suffix = useMemo(() => Math.random().toString(36).slice(2, 7), []);

  const derive = useCallback(
    (name: string) =>
      resolveTaskBranchName({
        rawBranch: name,
        branchPrefix,
        suffix,
        appendRandomSuffix,
        linkedIssue: linkedIssue ?? undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchPrefix, appendRandomSuffix, suffix, linkedIssue]
  );

  const [userValue, setUserValue] = useState<string | undefined>(undefined);
  const [isUserModified, setIsUserModified] = useState(false);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  const issueSource = linkedIssue
    ? issueMentionToken(linkedIssue.provider, linkedIssue.identifier, linkedIssue)
    : null;
  const [prevIssueSource, setPrevIssueSource] = useState(issueSource);

  // Reset when the project changes.
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setPrevIssueSource(issueSource);
    setUserValue(undefined);
    setIsUserModified(false);
  }

  // When the linked issue changes (user selects a different issue), clear user override.
  if (issueSource !== prevIssueSource) {
    setPrevIssueSource(issueSource);
    setUserValue(undefined);
    setIsUserModified(false);
  }

  const branchName = userValue !== undefined ? userValue : derive(taskName);

  const setBranchName = useCallback((value: string) => {
    setUserValue(value);
    setIsUserModified(true);
  }, []);

  // Pre-flight: check against the already-loaded local branch list in the repository store.
  const repo = projectId ? getGitRepositoryStore(projectId) : undefined;
  const branchAlreadyExists =
    branchName.trim().length > 0 &&
    (repo?.localBranches.some((branch) => branch.ref === `refs/heads/${branchName}`) ?? false);

  return { branchName, setBranchName, isUserModified, branchAlreadyExists };
}
