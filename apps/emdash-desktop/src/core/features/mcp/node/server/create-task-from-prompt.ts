import { randomUUID } from 'node:crypto';
import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { err, ok, type Result } from '@emdash/shared';
import {
  getPlugin,
  isValidProviderId,
  listPlugins,
} from '@core/features/agents/api/node/plugin-registry';
import { DEFAULT_AGENT_ID } from '@core/features/agents/contributions/settings';
import {
  generateRandom,
  generateTaskName,
} from '@core/features/tasks/api/node/name-generation/generateTaskName';
import type { CreateTaskParams, TaskConfig } from '@core/primitives/tasks/api';
import { resolveTaskBranchName } from '@core/primitives/tasks/api';
import { buildWorkspaceConfigFromPreset } from '@core/primitives/workspaces/api';
import type { AppSettingsService } from '@core/services/settings/node';
import { withProjectAttachment } from './attach-project';
import type { McpToolDependencies } from './dependencies';
import { isValidBranchName, resolveFromBranch } from './resolve-from-branch';

export type McpCreateTaskInput = {
  projectId: string;
  prompt?: string;
  name?: string;
  provider?: string;
  model?: string;
  branchName?: string;
  baseBranch?: string;
  chatUi?: boolean;
  autoApprove?: boolean;
};

export type McpCreateTaskResult = {
  taskId: string;
  taskName: string;
  branchName: string;
  /**
   * Null when the task was created without a prompt: no agent conversation is
   * started, so no provider or model is chosen and conversationType is 'none'.
   */
  provider: AgentProviderId | null;
  model: string | null;
  conversationType: 'pty' | 'acp' | 'none';
  /**
   * Null when no conversation is started. False when the caller asked for
   * auto-approve but the provider has no such mode, so the caller can tell the
   * request was dropped.
   */
  autoApprove: boolean | null;
  workspacePath: string;
  /** Set when the task exists but its agent was not started. */
  warning?: string;
};

/** Comma-separated provider ids, for error messages and tool descriptions. */
export function validProviderIds(): string {
  return listPlugins()
    .map((plugin) => plugin.metadata.id)
    .join(', ');
}

async function resolveProvider(
  appSettings: AppSettingsService,
  requested: string | undefined
): Promise<Result<AgentProviderId, string>> {
  if (requested) {
    if (!isValidProviderId(requested)) {
      return err(`Unknown provider "${requested}". Valid providers: ${validProviderIds()}`);
    }
    return ok(requested);
  }
  const configured = await appSettings.get('defaultAgent');
  return ok(isValidProviderId(configured) ? configured : DEFAULT_AGENT_ID);
}

/**
 * Mirrors the new-task modal: an explicit request wins over the app default,
 * and both are ignored for providers without an auto-approve mode.
 */
async function resolveAutoApprove(
  appSettings: AppSettingsService,
  provider: AgentProviderId,
  requested: boolean | undefined
): Promise<boolean> {
  if (getPlugin(provider).capabilities.autoApprove.kind !== 'supported') return false;
  if (requested !== undefined) return requested;
  return (await appSettings.get('tasks')).autoApproveByDefault;
}

export function resolveModel(
  provider: AgentProviderId,
  requested: string | undefined
): Result<string | undefined, string> {
  const model = requested?.trim();
  if (!model) return ok(undefined);
  const models = getPlugin(provider).capabilities.models;
  if (models.kind !== 'selectable') {
    return err(`Provider "${provider}" does not support model selection`);
  }
  if (!Object.hasOwn(models.modelOptions, model)) {
    const valid = Object.keys(models.modelOptions).join(', ');
    return err(`Unknown model "${model}" for provider "${provider}". Valid models: ${valid}`);
  }
  return ok(model);
}

async function resolveBranchName(
  appSettings: AppSettingsService,
  taskName: string,
  requested: string | undefined
): Promise<Result<string, string>> {
  const explicit = requested?.trim();
  if (explicit) {
    return isValidBranchName(explicit) ? ok(explicit) : err(`Invalid branch name: "${explicit}"`);
  }
  const project = await appSettings.get('project');
  const derived = resolveTaskBranchName({
    rawBranch: generateTaskName({ title: taskName }),
    branchPrefix: project.branchPrefix,
    suffix: Math.random().toString(36).slice(2, 7),
    appendRandomSuffix: project.appendRandomBranchSuffix,
  });
  return isValidBranchName(derived)
    ? ok(derived)
    : err(
        `Could not derive a valid branch name from task name "${taskName}"; pass branchName explicitly`
      );
}

/**
 * Creates a task in a fresh worktree, provisions it, and starts the initial
 * agent conversation from a prompt. Mirrors the new-task modal's flow, driven by
 * the local MCP server instead of the renderer.
 */
export async function createTaskFromPrompt(
  dependencies: McpToolDependencies,
  input: McpCreateTaskInput
): Promise<Result<McpCreateTaskResult, string>> {
  const { appSettings } = dependencies;
  // Prompt is optional: with one we start an agent conversation; without one the
  // task is provisioned and left idle for the user to drive later.
  const prompt = input.prompt?.trim() ?? '';

  // Provider/model only matter when a prompt starts a conversation; skip
  // resolving (and validating) them for a promptless task.
  let provider: AgentProviderId | null = null;
  let model: string | undefined;
  if (prompt) {
    const resolvedProvider = await resolveProvider(appSettings, input.provider);
    if (!resolvedProvider.success) return resolvedProvider;
    provider = resolvedProvider.data;

    const resolvedModel = resolveModel(provider, input.model);
    if (!resolvedModel.success) return resolvedModel;
    model = resolvedModel.data;
  }

  const taskName = input.name?.trim() || generateRandom();
  const resolvedBranch = await resolveBranchName(appSettings, taskName, input.branchName);
  if (!resolvedBranch.success) return resolvedBranch;
  const branchName = resolvedBranch.data;

  // Matches the new-task modal: chat UI is opt-in and only available when the
  // provider supports ACP; otherwise the agent runs in a terminal session.
  const conversationType: 'pty' | 'acp' | 'none' = !provider
    ? 'none'
    : (input.chatUi ?? false) && getPlugin(provider).capabilities.acp.kind === 'supported'
      ? 'acp'
      : 'pty';
  const autoApprove = provider
    ? await resolveAutoApprove(appSettings, provider, input.autoApprove)
    : null;
  const conversationId = randomUUID();
  const taskId = randomUUID();

  // Task sessions live inside the project attachment, and the attachment is
  // released with the last lease: starting an agent while the app itself does
  // not hold the project open would tear the session straight back down. Check
  // before taking our own lease, which would otherwise mask the answer.
  const projectWasOpen = dependencies.projects.requireAttached(input.projectId).success;

  const created = await withProjectAttachment(
    dependencies.projects,
    input.projectId,
    async (project) => {
      const fromBranch = await resolveFromBranch(project, input.baseBranch);
      if (!fromBranch.success) return fromBranch;

      const params: CreateTaskParams = {
        id: taskId,
        projectId: input.projectId,
        taskConfig: buildTaskConfig({
          taskName,
          conversationId,
          provider,
          model,
          prompt,
          conversationType,
          autoApprove,
        }),
        workspaceConfig: buildWorkspaceConfigFromPreset(
          'new-worktree',
          {},
          { fromBranch: fromBranch.data, branchName, pushBranch: false }
        ),
      };

      const result = await dependencies.tasks.createTask(params);
      if (!result.success) return err(createTaskErrorMessage(result.error));

      // Provisioning is renderer-driven in the normal flow; an MCP-created task
      // has no view open, so drive it here or the worktree never lands on disk.
      const provisioned = await dependencies.tasks.provisionWorkspace(taskId);
      if (!provisioned.success) {
        return err(
          `Task ${taskId} was created but workspace provisioning failed: ${provisionErrorMessage(
            provisioned.error
          )}`
        );
      }

      // Start the session while still attached: the task session is registered
      // by provisioning and torn down when the attachment ends.
      const warning =
        conversationType === 'none'
          ? undefined
          : !projectWasOpen
            ? 'The project is not open in Emdash, so the agent was not started: a session ' +
              'started now would be stopped again as soon as this call returns. Opening the ' +
              'task in Emdash starts it on the prompt.'
            : await startConversationWarning(dependencies, {
                projectId: input.projectId,
                taskId,
                conversationId,
                type: conversationType,
              });
      return ok({ path: provisioned.data.path, warning });
    }
  );
  if (!created.success) return created;

  return ok({
    taskId,
    taskName,
    branchName,
    provider,
    model: model ?? null,
    conversationType,
    autoApprove,
    workspacePath: created.data.path,
    ...(created.data.warning && { warning: created.data.warning }),
  });
}

async function startConversationWarning(
  dependencies: McpToolDependencies,
  input: { projectId: string; taskId: string; conversationId: string; type: 'pty' | 'acp' }
): Promise<string | undefined> {
  const started = await dependencies.startInitialConversation(input);
  if (started.started) return undefined;
  return `The task was created but its agent session did not start${
    started.message ? `: ${started.message}` : ''
  }. Opening the task in Emdash will start it.`;
}

function buildTaskConfig(options: {
  taskName: string;
  conversationId: string;
  provider: AgentProviderId | null;
  model: string | undefined;
  prompt: string;
  conversationType: 'pty' | 'acp' | 'none';
  autoApprove: boolean | null;
}): TaskConfig {
  const { provider, conversationType, prompt } = options;
  if (!provider || conversationType === 'none') {
    return { version: '1', name: options.taskName };
  }
  return {
    version: '1',
    name: options.taskName,
    initialConversation: {
      id: options.conversationId,
      provider,
      title: options.taskName,
      type: conversationType,
      ...(options.autoApprove !== null && { autoApprove: options.autoApprove }),
      ...(options.model && { model: options.model }),
      ...(conversationType === 'acp'
        ? { initialQueue: [{ text: prompt }] }
        : { initialPrompt: prompt }),
    },
  };
}

function createTaskErrorMessage(error: {
  type: string;
  message?: string;
  branch?: string;
}): string {
  if (error.message) return `Failed to create task: ${error.message}`;
  if (error.branch) return `Failed to create task (${error.type}): ${error.branch}`;
  return `Failed to create task: ${error.type}`;
}

function provisionErrorMessage(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}
