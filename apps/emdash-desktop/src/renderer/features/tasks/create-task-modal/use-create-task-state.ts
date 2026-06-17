import type { GitBranchRef } from '@emdash/shared/git';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { getIssueTaskName } from './issue-task-name';
import { useTaskName } from './use-task-name';
import { useWorkspaceConfig } from './use-workspace-config';

export type LinkedType = 'issue' | 'pr' | null;

export type CreateTaskState = ReturnType<typeof useCreateTaskState>;

export function useCreateTaskState(
  projectId: string | undefined,
  defaultBranch: GitBranchRef | undefined,
  isUnborn: boolean,
  currentBranch: string | null,
  repositoryWorkspaceId: string | null | undefined,
  initialPR?: PullRequest,
  initialLinkedType: LinkedType = null
) {
  const { autoGenerateName, createBranchAndWorktree } = useTaskSettings();

  const [linkedType, setLinkedTypeRaw] = useState<LinkedType>(initialPR ? 'pr' : initialLinkedType);
  const [linkedIssue, setLinkedIssueRaw] = useState<LinkedIssue | null>(null);
  const [linkedPR, setLinkedPRRaw] = useState<PullRequest | null>(initialPR ?? null);
  const [prevProjectId, setPrevProjectId] = useState(projectId);

  // Reset linked state when project changes.
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setLinkedTypeRaw(null);
    setLinkedIssueRaw(null);
    setLinkedPRRaw(null);
  }

  // Stable random key for the "plain task" name generation — one per modal session.
  const randomKey = useMemo(() => crypto.randomUUID(), []);

  // Random name query — used when no issue/PR is selected yet.
  const hasLinkedEntity =
    (linkedType === 'issue' && linkedIssue !== null) || (linkedType === 'pr' && linkedPR !== null);
  const { data: randomName, isPending: isRandomPending } = useQuery({
    queryKey: ['generateTaskName', 'random', randomKey],
    queryFn: () => rpc.tasks.generateTaskName({}),
    enabled: autoGenerateName && !hasLinkedEntity,
    refetchOnWindowFocus: false,
  });

  // Issue-derived name (Linear can derive directly from branchName; others need AI)
  const directIssueTaskName = getIssueTaskName(linkedIssue);
  const shouldGenerateFromIssue =
    autoGenerateName &&
    linkedType === 'issue' &&
    linkedIssue !== null &&
    directIssueTaskName === null;
  const { data: issueGeneratedName, isPending: isIssuePending } = useQuery({
    queryKey: ['generateTaskName', linkedIssue?.title ?? null, linkedIssue?.description ?? null],
    queryFn: () =>
      rpc.tasks.generateTaskName({
        title: linkedIssue!.title,
        description: linkedIssue!.description,
      }),
    enabled: shouldGenerateFromIssue,
    refetchOnWindowFocus: false,
  });

  // PR-derived name
  const shouldGenerateFromPR = autoGenerateName && linkedType === 'pr' && linkedPR !== null;
  const { data: prGeneratedName, isPending: isPRPending } = useQuery({
    queryKey: ['generateTaskName', linkedPR?.title ?? null, linkedPR?.description ?? null],
    queryFn: () =>
      rpc.tasks.generateTaskName({
        title: linkedPR!.title,
        description: linkedPR!.description ?? undefined,
      }),
    enabled: shouldGenerateFromPR,
    refetchOnWindowFocus: false,
  });

  // Pick the effective generated name and pending state based on linked type + selection.
  const generatedName = (() => {
    if (linkedType === 'issue' && linkedIssue !== null) {
      return directIssueTaskName ?? (shouldGenerateFromIssue ? issueGeneratedName : undefined);
    }
    if (linkedType === 'pr' && linkedPR !== null) {
      return shouldGenerateFromPR ? prGeneratedName : undefined;
    }
    // No entity selected yet — fall back to random placeholder name.
    return autoGenerateName ? randomName : undefined;
  })();

  const isPending = (() => {
    if (linkedType === 'issue' && linkedIssue !== null)
      return shouldGenerateFromIssue && isIssuePending;
    if (linkedType === 'pr' && linkedPR !== null) return shouldGenerateFromPR && isPRPending;
    return autoGenerateName && isRandomPending;
  })();

  const taskName = useTaskName({
    generatedName,
    isPending,
    resetKey: projectId,
  });

  const workspaceConfig = useWorkspaceConfig({
    projectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    repositoryWorkspaceId,
    pr: linkedType === 'pr' ? linkedPR : null,
    taskName: taskName.effectiveTaskName,
    linkedIssue: linkedType === 'issue' ? linkedIssue : null,
    createBranchAndWorktreeDefault: createBranchAndWorktree,
    resetKey: projectId,
  });

  // Switching linked type clears the selection for the previous type.
  const setLinkedType = (type: LinkedType) => {
    setLinkedTypeRaw(type);
  };

  const setLinkedIssue = (issue: LinkedIssue | null) => {
    setLinkedIssueRaw(issue);
  };

  const setLinkedPR = (pr: PullRequest | null) => {
    setLinkedPRRaw(pr);
  };

  // Issue/PR selection is optional enrichment — not required for creation.
  const isValid =
    taskName.effectiveTaskName.trim().length > 0 && !taskName.isPending && workspaceConfig.isValid;

  return {
    linkedType,
    setLinkedType,
    linkedIssue,
    setLinkedIssue,
    linkedPR,
    setLinkedPR,
    taskName,
    workspaceConfig,
    isValid,
  };
}
