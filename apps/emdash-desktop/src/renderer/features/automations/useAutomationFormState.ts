import { useMemo, useState } from 'react';
import { DEFAULT_CRON_STATE, toCron } from '@renderer/lib/CronPicker/cron-utils';
import { isValidProviderId } from '@shared/core/agents/agent-provider-registry';
import type { Automation } from '@shared/core/automations/automation';
import type { StoredAutomationTaskConfig, TriggerConfig } from '@shared/core/automations/config';
import { getLocalTimeZone } from '@shared/core/automations/timezone';
import type { Branch } from '@shared/core/git/git';
import {
  asMounted,
  firstMountedProjectId,
  getProjectStore,
} from '../projects/stores/project-selectors';
import { useInitialConversationState } from '../tasks/conversations/initial-conversation-section';
import { useProjectGitContext } from '../tasks/create-task-modal/use-project-git-context';
import { useTaskName } from '../tasks/create-task-modal/use-task-name';
import {
  useWorkspaceConfig,
  type WorkspaceConfigInitial,
} from '../tasks/create-task-modal/use-workspace-config';
import type { BuiltinAutomationTemplate } from './automation-template';

const DEFAULT_CRON = toCron(DEFAULT_CRON_STATE);

/**
 * Derives the initial workspace config state for seeding the form from a stored automation.
 */
function workspaceInitialFromConfig(
  config: StoredAutomationTaskConfig | null | undefined
): WorkspaceConfigInitial & { fromBranch?: Branch; pushBranch?: boolean } {
  if (!config) return { mode: 'new-worktree', presetId: 'new-worktree' };
  const { git, workspace } = config.workspaceConfig;

  if (workspace.kind === 'byoi' || (workspace as { host?: string }).host === 'byoi') {
    return { mode: 'sandbox', presetId: 'sandbox' };
  }

  if (git.kind === 'create-branch') {
    return {
      mode: 'new-worktree',
      presetId: 'new-worktree',
      fromBranch: git.fromBranch,
      pushBranch: git.pushBranch,
    };
  }

  if (git.kind === 'none') {
    if (workspace.kind === 'repository-instance') {
      return {
        mode: 'existing',
        presetId: 'use-existing',
        selectedWorkspaceId: workspace.workspaceId,
      };
    }
    // repo-root or unknown
    return { mode: 'existing', presetId: 'repo-root' };
  }

  return { mode: 'new-worktree', presetId: 'new-worktree' };
}

export type AutomationFormState = ReturnType<typeof useAutomationFormState>;

export function useAutomationFormState(
  seed?: Automation,
  initialTemplate?: BuiltinAutomationTemplate
) {
  const seedTrigger = seed?.triggerConfig;
  const seedConversationConfig = seed?.conversationConfig;
  const seedConfig = seed?.taskConfig;
  const seedPrompt =
    seedConversationConfig?.prompt ?? initialTemplate?.defaultConversationConfig.initialPrompt;

  const [name, setName] = useState(seed?.name ?? initialTemplate?.name ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    seed?.projectId ?? firstMountedProjectId()
  );
  const [cronExpr, setCronExpr] = useState<string>(
    seedTrigger?.expr ?? initialTemplate?.defaultTrigger.expr ?? DEFAULT_CRON
  );
  const [cronTz] = useState<string>(seedTrigger?.tz ?? getLocalTimeZone());

  const effectiveProjectId =
    projectId && asMounted(getProjectStore(projectId)) ? projectId : firstMountedProjectId();

  const seedProvider = isValidProviderId(seedConversationConfig?.provider)
    ? seedConversationConfig?.provider
    : undefined;

  const initialConversation = useInitialConversationState(effectiveProjectId, seedProvider);

  const [promptSeeded, setPromptSeeded] = useState(false);
  if (!promptSeeded && seedPrompt) {
    setPromptSeeded(true);
    initialConversation.setPrompt(seedPrompt);
  }

  const { defaultBranch, isUnborn, currentBranch, repositoryWorkspaceId } =
    useProjectGitContext(effectiveProjectId);

  // Derive initial workspace config state from stored automation (for edit mode).
  const wsInitial = useMemo(() => workspaceInitialFromConfig(seedConfig), [seedConfig]);

  const taskName = useTaskName({
    generatedName: seedConfig?.taskConfig.name,
    resetKey: effectiveProjectId,
  });

  const workspaceConfig = useWorkspaceConfig({
    projectId: effectiveProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    repositoryWorkspaceId,
    pr: null, // automations don't link PRs
    taskName: taskName.effectiveTaskName || name,
    linkedIssue: null,
    createBranchAndWorktreeDefault: wsInitial.mode === 'new-worktree',
    resetKey: effectiveProjectId,
    initial: wsInitial,
  });

  const prompt = initialConversation.prompt;
  const provider = initialConversation.provider ?? 'claude';

  const canSave =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    !!effectiveProjectId &&
    workspaceConfig.isValid;

  function buildTaskConfig(targetProjectId: string): StoredAutomationTaskConfig | null {
    const effectiveRepoWsId =
      asMounted(getProjectStore(targetProjectId))?.data?.repositoryWorkspaceId ?? null;

    // Re-resolve with the target project's repositoryWorkspaceId in case it differs.
    // For most cases effectiveProjectId === targetProjectId so workspaceConfig.resolvedConfig is correct.
    // We only need to patch if mode=existing/repo-root and the workspace ID is project-specific.
    const wsConfig = workspaceConfig.resolvedConfig;

    // Patch repository-instance workspace if target project differs.
    const patchedConfig =
      wsConfig.workspace.kind === 'repository-instance' && effectiveRepoWsId
        ? {
            ...wsConfig,
            workspace: { kind: 'repository-instance' as const, workspaceId: effectiveRepoWsId },
          }
        : wsConfig;

    const result: StoredAutomationTaskConfig = {
      version: '1',
      taskConfig: {
        version: '1',
        name: taskName.effectiveTaskName?.trim() || name.trim(),
        linkedIssue: seedConfig?.taskConfig.linkedIssue,
        initialStatus: seedConfig?.taskConfig.initialStatus,
      },
      workspaceConfig: patchedConfig,
    };

    // Strip MobX Proxy wrappers (e.g. fromBranch coming from getGitRepositoryStore)
    // before the value crosses the Electron contextBridge. The structured clone
    // algorithm rejects Proxy objects with a DataCloneError.
    return JSON.parse(JSON.stringify(result)) as StoredAutomationTaskConfig;
  }

  const triggerConfig: TriggerConfig = { expr: cronExpr.trim(), tz: cronTz };

  function applyTemplate(template: BuiltinAutomationTemplate) {
    setName(template.name);
    setCronExpr(template.defaultTrigger.expr);
    initialConversation.setPrompt(template.defaultConversationConfig.initialPrompt);
  }

  return {
    name,
    setName,
    projectId,
    setProjectId,
    effectiveProjectId,
    cronExpr,
    setCronExpr,
    cronTz,
    initialConversation,
    workspaceConfig,
    isUnborn,
    currentBranch,
    prompt,
    provider,
    canSave,
    triggerConfig,
    applyTemplate,
    buildTaskConfig,
  };
}
