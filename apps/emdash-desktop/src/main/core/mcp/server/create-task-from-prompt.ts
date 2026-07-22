import { randomUUID } from 'node:crypto';
import type { GitBranchRef } from '@emdash/core/git';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { err, ok, type Result } from '@emdash/shared';
import { getAcpRuntimeClient } from '@main/core/acp/controller';
import { getPlugin, isValidProviderId, listPlugins } from '@main/core/agents/plugin-registry';
import { createConversation } from '@main/core/conversations/createConversation';
import type { GitRepositoryService } from '@main/core/git/repository/service';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import {
  generateRandom,
  generateTaskName,
} from '@main/core/tasks/name-generation/generateTaskName';
import {
  commitCreateTask,
  finalizeCreateTask,
  prepareCreateTask,
} from '@main/core/tasks/operations/createTask';
import { taskService } from '@main/core/tasks/task-service';
import { db } from '@main/db/client';
import type { ConversationRow, TaskRow } from '@main/db/schema';
import type { ConversationType } from '@shared/core/conversations/conversations';
import type { CreateTaskParams } from '@shared/core/tasks/tasks';
import { buildWorkspaceConfigFromPreset } from '@shared/core/workspaces/build-workspace-config-from-preset';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';

export type McpCreateTaskInput = {
  projectId: string;
  prompt?: string;
  name?: string;
  provider?: string;
  model?: string;
  branchName?: string;
  baseBranch?: string;
  chatUi?: boolean;
};

export type McpCreateTaskResult = {
  taskId: string;
  taskName: string;
  branchName: string;
  // Null when the task was created without a prompt: no agent conversation is
  // started, so no provider/model is chosen and conversationType is 'none'.
  provider: AgentProviderId | null;
  model: string | null;
  conversationType: ConversationType | 'none';
  workspacePath: string;
};

export async function ensureProjectOpen(projectId: string) {
  let project = projectManager.getProject(projectId);
  if (!project) {
    const openResult = await openProject(projectId);
    if (!openResult.success) return undefined;
    project = projectManager.getProject(projectId);
  }
  return project;
}

/** Comma-separated provider ids, for error messages and tool descriptions. */
export function validProviderIds(): string {
  return listPlugins()
    .map((plugin) => plugin.metadata.id)
    .join(', ');
}

async function resolveProvider(
  requested: string | undefined
): Promise<Result<AgentProviderId, string>> {
  if (requested) {
    if (!isValidProviderId(requested)) {
      return err(`Unknown provider "${requested}". Valid providers: ${validProviderIds()}`);
    }
    return ok(requested);
  }
  const configured = await appSettingsService.get('defaultAgent');
  return ok(isValidProviderId(configured) ? configured : DEFAULT_AGENT_ID);
}

/**
 * Practical subset of `git check-ref-format --branch`: rejects names git would
 * refuse, so task creation fails here with a clear message instead of deep in
 * worktree provisioning after the task row already exists.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name === '@') return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  return !name
    .split('/')
    .some(
      (segment) => segment.startsWith('.') || segment.endsWith('.') || segment.endsWith('.lock')
    );
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

/**
 * Builds the create-branch ref, matching what the renderer's new-task modal
 * resolves for the "new worktree" preset: the base remote's ref when the
 * branch is known there, a local ref otherwise.
 */
export async function resolveFromBranch(
  gitRepository: GitRepositoryService,
  requested: string | undefined
): Promise<Result<GitBranchRef, string>> {
  // Resolve the base remote once and reuse it: getDefaultBranch would
  // otherwise repeat the settings + `git remote` lookups internally.
  const [remotes, baseRemote] = await Promise.all([
    gitRepository.getRemotes(),
    gitRepository.getBaseRemote(),
  ]);
  const defaultBranch = await gitRepository.getDefaultBranch(baseRemote);

  const branch = requested?.trim() || defaultBranch;
  if (branch === defaultBranch) {
    const remote = remotes.find((r) => r.name === baseRemote);
    return ok(
      remote
        ? { type: 'remote', branch, remote: { name: remote.name, url: remote.url } }
        : { type: 'local', branch }
    );
  }

  const snapshot = await gitRepository.getSnapshot();
  const candidates = snapshot.refs.value.branches.filter((b) => b.branch === branch);
  const picked =
    candidates.find((b) => b.type === 'remote' && b.remote.name === baseRemote) ??
    candidates.find((b) => b.type === 'local') ??
    candidates[0];
  if (!picked) {
    const hint = branch.includes('/')
      ? ' Pass the branch name without a remote prefix (e.g. "main" instead of "origin/main").'
      : '';
    return err(`Branch "${branch}" not found in the repository.${hint}`);
  }
  return picked.type === 'remote'
    ? ok({
        type: 'remote',
        branch: picked.branch,
        remote: { name: picked.remote.name, url: picked.remote.url },
      })
    : ok({ type: 'local', branch: picked.branch });
}

function sessionStartFailure(taskId: string, detail: string): string {
  return `Task ${taskId} was created but the agent session failed to start: ${detail}`;
}

/**
 * Creates a task with a new worktree, provisions it, and starts the initial
 * agent conversation from a prompt. Mirrors the automation task-create flow
 * (`executeTaskCreate`) but is driven by the local MCP server instead of an
 * automation run.
 */
export async function createTaskFromPrompt(
  input: McpCreateTaskInput
): Promise<Result<McpCreateTaskResult, string>> {
  // Prompt is optional: with one, we start an agent conversation; without one,
  // the task is provisioned and left idle for the user to drive later.
  const prompt = input.prompt?.trim() ?? '';

  const project = await ensureProjectOpen(input.projectId);
  if (!project) return err(`Project not found: ${input.projectId}`);

  // Provider/model only matter when a prompt starts a conversation; skip
  // resolving (and validating) them for a promptless task.
  let provider: AgentProviderId | null = null;
  let model: string | undefined;
  if (prompt) {
    const providerResult = await resolveProvider(input.provider);
    if (!providerResult.success) return providerResult;
    provider = providerResult.data;

    const modelResult = resolveModel(provider, input.model);
    if (!modelResult.success) return modelResult;
    model = modelResult.data;
  }

  const taskName = input.name?.trim() || generateRandom();
  const branchName = input.branchName?.trim() || generateTaskName({ title: taskName });
  if (!isValidBranchName(branchName)) {
    return input.branchName?.trim()
      ? err(`Invalid branch name: "${branchName}"`)
      : err(
          `Could not derive a valid branch name from task name "${taskName}"; pass branchName explicitly`
        );
  }

  const fromBranchResult = await resolveFromBranch(project.gitRepository, input.baseBranch);
  if (!fromBranchResult.success) return fromBranchResult;
  const fromBranch = fromBranchResult.data;

  const workspaceConfig: WorkspaceConfig = buildWorkspaceConfigFromPreset(
    'new-worktree',
    {},
    { fromBranch, branchName, pushBranch: false }
  );

  const taskId = randomUUID();
  const createTaskParams: CreateTaskParams = {
    id: taskId,
    projectId: input.projectId,
    taskConfig: { version: '1', name: taskName },
    workspaceConfig,
  };

  const prepared = await prepareCreateTask(createTaskParams);
  if (!prepared.success) return err(`Failed to create task: ${prepared.error.type}`);

  let taskRow!: TaskRow;
  let convRow: ConversationRow | undefined;
  db.transaction((tx) => {
    ({ taskRow, convRow } = commitCreateTask(prepared.data, tx));
  });
  const created = finalizeCreateTask(prepared.data, taskRow, convRow);
  taskService.notifyTaskCreated(created.task, createTaskParams);

  const provision = await taskService.launch(taskId);
  if (!provision.success) {
    const detail =
      provision.error.type === 'setup-failed'
        ? (provision.error.message ?? provision.error.stepErrorType)
        : provision.error.type;
    return err(`Task ${taskId} was created but workspace provisioning failed: ${detail}`);
  }

  // No prompt: the worktree is provisioned and the task exists, but no agent
  // conversation is started. The user drives it later from the UI.
  if (!prompt || !provider) {
    return ok({
      taskId,
      taskName,
      branchName,
      provider: null,
      model: null,
      conversationType: 'none',
      workspacePath: provision.data.path,
    });
  }

  // Matches the new-task modal: chat UI is opt-in and only available when the
  // provider supports ACP; otherwise the agent runs in a terminal session.
  const acpSupported = getPlugin(provider).capabilities.acp.kind === 'supported';
  const conversationType: ConversationType =
    (input.chatUi ?? false) && acpSupported ? 'acp' : 'pty';
  const conversationId = randomUUID();
  const initialQueue = [{ text: prompt }];

  try {
    await createConversation({
      id: conversationId,
      projectId: input.projectId,
      taskId,
      provider,
      title: taskName,
      isInitialConversation: true,
      type: conversationType,
      ...(model && { model }),
      ...(conversationType === 'acp' ? { initialQueue } : { initialPrompt: prompt }),
    });
  } catch (error) {
    // PTY conversations spawn eagerly and createConversation rethrows on spawn
    // failure; surface it as a structured error like the ACP branch below.
    return err(sessionStartFailure(taskId, error instanceof Error ? error.message : String(error)));
  }

  if (conversationType === 'acp') {
    const acpClient = await getAcpRuntimeClient();
    const startResult = await acpClient.startSession({
      input: {
        conversationId,
        projectId: input.projectId,
        taskId,
        providerId: provider,
        workspaceId: provision.data.workspaceId,
        cwd: provision.data.path,
        sessionId: null,
        model: model ?? null,
        initialQueue,
      },
    });
    if (!startResult.success) {
      return err(sessionStartFailure(taskId, startResult.error.message ?? startResult.error.type));
    }
  }

  return ok({
    taskId,
    taskName,
    branchName,
    provider,
    model: model ?? null,
    conversationType,
    workspacePath: provision.data.path,
  });
}
