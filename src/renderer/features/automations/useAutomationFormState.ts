import { useMemo, useState } from 'react';
import { isValidProviderId } from '@shared/agent-provider-registry';
import type { Automation, BuiltinAutomationTemplate } from '@shared/automations/automation';
import type { StoredAutomationTaskConfig, TriggerConfig } from '@shared/automations/config';
import { DEFAULT_SCHEDULE, scheduleToCron } from '@shared/automations/schedule';
import { getLocalTimeZone } from '@shared/automations/timezone';
import type { Branch } from '@shared/git';
import type { WorkspaceConfig, WorkspaceTarget } from '@shared/workspace-config';
import {
  asMounted,
  firstMountedProjectId,
  getProjectStore,
  getRepositoryStore,
} from '../projects/stores/project-selectors';
import { useInitialConversationState } from '../tasks/conversations/initial-conversation-section';
import { useBranchName } from '../tasks/create-task-modal/use-branch-name';
import { useBranchSelection } from '../tasks/create-task-modal/use-branch-selection';
import { useTaskName } from '../tasks/create-task-modal/use-task-name';

const DEFAULT_CRON = scheduleToCron(DEFAULT_SCHEDULE);

export function branchInitialFromConfig(config: StoredAutomationTaskConfig | null | undefined): {
  createBranchAndWorktree: boolean;
  pushBranch?: boolean;
  branchOverride?: Branch;
} {
  if (!config) return { createBranchAndWorktree: true };
  const git = config.workspaceConfig.git;
  if (git.kind === 'create-branch') {
    return {
      createBranchAndWorktree: true,
      pushBranch: git.pushBranch,
      branchOverride: git.fromBranch,
    };
  }
  if (git.kind === 'none') return { createBranchAndWorktree: false };
  return { createBranchAndWorktree: true };
}

export function plainBranch(branch: Branch): Branch {
  if (branch.type === 'remote') {
    return {
      type: 'remote',
      branch: branch.branch,
      remote: { name: branch.remote.name, url: branch.remote.url },
    };
  }
  return branch.remote
    ? {
        type: 'local',
        branch: branch.branch,
        remote: { name: branch.remote.name, url: branch.remote.url },
      }
    : { type: 'local', branch: branch.branch };
}

export type AutomationFormState = ReturnType<typeof useAutomationFormState>;

export function useAutomationFormState(seed?: Automation, template?: BuiltinAutomationTemplate) {
  const seedTrigger = seed?.triggerConfig;
  const seedConversationConfig = seed?.conversationConfig;
  const seedConfig = seed?.taskConfig;

  const [name, setName] = useState(seed?.name ?? template?.name ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    seed?.projectId ?? firstMountedProjectId()
  );
  const [cronExpr, setCronExpr] = useState<string>(
    seedTrigger?.expr ?? template?.defaultTrigger.expr ?? DEFAULT_CRON
  );
  const [cronTz] = useState<string>(seedTrigger?.tz ?? getLocalTimeZone());
  const [useBYOI, setUseBYOI] = useState(() => {
    const ws = seedConfig?.workspaceConfig.workspace;
    return ws?.kind === 'byoi' || (ws as { host?: string } | undefined)?.host === 'byoi';
  });

  const effectiveProjectId =
    projectId && asMounted(getProjectStore(projectId)) ? projectId : firstMountedProjectId();

  const seedProvider = isValidProviderId(seedConversationConfig?.provider)
    ? seedConversationConfig?.provider
    : undefined;

  const seedPrompt =
    seedConversationConfig?.prompt ?? template?.defaultConversationConfig.initialPrompt ?? '';
  const initialConversation = useInitialConversationState(
    effectiveProjectId,
    seedProvider,
    seedPrompt
  );

  const repo = effectiveProjectId ? getRepositoryStore(effectiveProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;

  const branchInitial = useMemo(() => branchInitialFromConfig(seedConfig), [seedConfig]);
  const taskName = useTaskName({
    generatedName: seedConfig?.taskConfig.name,
    resetKey: effectiveProjectId,
  });
  const branchSelection = useBranchSelection(
    effectiveProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    branchInitial
  );
  const branchNameState = useBranchName({
    taskName: taskName.effectiveTaskName || name,
    projectId: effectiveProjectId,
    resetKey: effectiveProjectId,
  });

  const isBranchValid =
    !branchSelection.createBranchAndWorktree ||
    (branchNameState.branchName.trim().length > 0 && !branchNameState.branchAlreadyExists);
  const isTaskConfigValid = !!branchSelection.selectedBranch && isBranchValid;

  const fromBranch = {
    selectedBranch: branchSelection.selectedBranch,
    createBranchAndWorktree: branchSelection.createBranchAndWorktree,
    pushBranch: branchSelection.pushBranch,
    branchName: branchNameState.branchName,
    taskName: taskName.effectiveTaskName,
    isValid: isTaskConfigValid,
  };

  const prompt = initialConversation.prompt;
  const provider = initialConversation.provider ?? 'claude';

  const canSave =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    !!effectiveProjectId &&
    fromBranch.isValid;

  function buildTaskConfig(
    targetProjectId: string,
    useBYOIOverride?: boolean
  ): StoredAutomationTaskConfig | null {
    const effectiveBYOI = useBYOIOverride ?? useBYOI;
    if (!fromBranch.selectedBranch) return null;
    const noWorktree = isUnborn || !fromBranch.createBranchAndWorktree || effectiveBYOI;
    const git = noWorktree
      ? { kind: 'none' as const }
      : {
          kind: 'create-branch' as const,
          branchName: fromBranch.branchName,
          fromBranch: plainBranch(fromBranch.selectedBranch),
          pushBranch: fromBranch.pushBranch,
        };
    let workspace: WorkspaceTarget;
    if (effectiveBYOI) {
      workspace = { kind: 'byoi' };
    } else if (git.kind === 'none') {
      const repositoryWorkspaceId = asMounted(getProjectStore(targetProjectId))?.data
        ?.repositoryWorkspaceId;
      workspace = repositoryWorkspaceId
        ? { kind: 'repository-instance', workspaceId: repositoryWorkspaceId }
        : { kind: 'new-worktree' };
    } else {
      workspace = { kind: 'new-worktree' };
    }
    const workspaceConfig: WorkspaceConfig = { version: '2', git, workspace };
    return {
      version: '1',
      taskConfig: {
        version: '1',
        name: fromBranch.taskName?.trim() || name.trim(),
        linkedIssue: seedConfig?.taskConfig.linkedIssue,
        initialStatus: seedConfig?.taskConfig.initialStatus,
      },
      workspaceConfig,
    };
  }

  const triggerConfig: TriggerConfig = { expr: cronExpr.trim(), tz: cronTz };

  return {
    name,
    setName,
    projectId,
    setProjectId,
    effectiveProjectId,
    cronExpr,
    setCronExpr,
    cronTz,
    useBYOI,
    setUseBYOI,
    initialConversation,
    branchSelection,
    branchNameState,
    fromBranch,
    isUnborn,
    currentBranch,
    prompt,
    provider,
    canSave,
    triggerConfig,
    buildTaskConfig,
  };
}
