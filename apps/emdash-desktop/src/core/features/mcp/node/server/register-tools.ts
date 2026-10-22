import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import z from 'zod';
import {
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { attachProject } from './attach-project';
import { createTaskFromPrompt, validProviderIds } from './create-task-from-prompt';
import type { McpToolDependencies } from './dependencies';
import { runTaskScript, stopTaskScript } from './run-task-script';
import {
  inspectBranchDeletion,
  inspectWorktreeChanges,
  resolveTaskWorkspaceId,
  resolveWorkspaceRuntime,
  type BranchDeletionState,
  type TaskBranch,
  type WorktreeChangeCounts,
  type WorktreeChangesState,
} from './workspace-runtime';

const MAX_LISTED_TASKS = 50;

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

type ToolResult = ReturnType<typeof textResult> | ReturnType<typeof errorResult>;

/**
 * The SDK forwards a thrown exception's message verbatim to the MCP client;
 * catch here so internal errors (db, host runtime) are logged but only a generic
 * message leaves the process.
 */
function guarded<Args extends unknown[]>(
  dependencies: McpToolDependencies,
  toolName: string,
  fn: (...args: Args) => Promise<ToolResult>
) {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      dependencies.logger.error(`McpHttpServer: ${toolName} failed`, { error: String(error) });
      return errorResult(`Emdash hit an internal error while handling ${toolName}`);
    }
  };
}

async function findTaskInProject(
  dependencies: McpToolDependencies,
  projectId: string,
  taskId: string
) {
  const [row] = await dependencies.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .limit(1);
  return row;
}

type DeleteConfirmationGate = Readonly<{
  reason: string;
  changes?: WorktreeChangeCounts | null;
  /** Commits only the task branch has, or null when they could not be counted. */
  unpushedCommits?: number | null;
}>;

/** What the caller asked to remove, mirroring the delete dialog's checkboxes. */
type DeleteRequest = Readonly<{
  deleteWorktree: boolean;
  deleteBranch: boolean;
}>;

type DeleteDecision = Readonly<{
  /**
   * Artifact removal is only requested for a worktree the preflight says this
   * delete owns — the same condition the delete dialog puts its "Delete
   * worktree" checkbox behind. Asking for it outside that case would destroy a
   * checkout the gate below never inspected.
   */
  deleteWorktree: boolean;
  /**
   * Like the dialog's "Delete branch" checkbox: only a branch the task created
   * from a source branch, and only together with its worktree. On top of that,
   * only when the worktree is verifiably on that branch, since the host deletes
   * whatever is checked out.
   */
  deleteBranch: boolean;
  /** Why a requested branch delete was dropped, or null when it was not. */
  branchKeptReason: string | null;
  /** Why the delete needs confirmation, or null when it is verifiably safe. */
  gate: DeleteConfirmationGate | null;
}>;

const BRANCH_NOT_OWNED =
  'Emdash only deletes a branch the task created, together with its worktree.';

function worktreeChangesGate(changes: WorktreeChangesState): DeleteConfirmationGate | null {
  if (changes.kind === 'clean') return null;
  if (changes.kind === 'unknown') {
    return {
      reason:
        'Emdash could not check the worktree for uncommitted changes ' +
        `(${changes.reason}), so it may contain work that would be lost.`,
    };
  }
  return {
    reason: 'The task worktree has uncommitted changes that will be permanently lost.',
    changes: changes.counts,
  };
}

function branchDeletionGate(state: BranchDeletionState): DeleteConfirmationGate | null {
  if (state.kind === 'safe' || state.kind === 'not-checked-out') return null;
  if (state.kind === 'unknown') {
    return {
      reason:
        'Emdash could not check the task branch for unpushed commits ' +
        `(${state.reason}), so deleting the branch may lose commits.`,
      unpushedCommits: null,
    };
  }
  const [noun, pronoun] = state.count === 1 ? ['commit', 'it'] : ['commits', 'them'];
  return {
    reason:
      `The task branch has ${state.count} ${noun} not on its upstream or source branch; ` +
      `deleting the branch may lose ${pronoun} permanently.`,
    unpushedCommits: state.count,
  };
}

/** The provisioned task branch of a workspace, or null when it has none to delete. */
async function findTaskBranch(
  dependencies: McpToolDependencies,
  workspaceId: string
): Promise<TaskBranch | null> {
  const [workspace] = await dependencies.db
    .select({ kind: workspaces.kind, config: workspaces.config })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), liveWorkspaces()))
    .limit(1);
  const name = workspace ? getProvisionedWorkspaceBranch(workspace) : null;
  if (!workspace || !name) return null;
  const git = workspace.config?.git;
  return { name, fromBranch: git?.kind === 'create-branch' ? git.fromBranch : null };
}

/**
 * Decides what deleting a task removes, and why that needs the user's explicit
 * confirmation.
 *
 * Fails closed: a worktree or branch whose state cannot be read counts as
 * needing confirmation, because refusing a delete is recoverable and deleting
 * uncommitted work or unpushed commits is not. A branch that cannot be
 * positively identified as the task's own is kept rather than gated, since no
 * confirmation makes deleting the wrong branch right.
 */
async function resolveDeleteDecision(
  dependencies: McpToolDependencies,
  projectId: string,
  taskId: string,
  request: DeleteRequest
): Promise<DeleteDecision> {
  const keep = (reason: string) => (request.deleteBranch ? reason : null);

  // Keeping the worktree keeps the branch too, so nothing on disk is at stake.
  if (!request.deleteWorktree) {
    return {
      deleteWorktree: false,
      deleteBranch: false,
      branchKeptReason: keep(BRANCH_NOT_OWNED),
      gate: null,
    };
  }

  const preflight = await dependencies.tasks.getDeletePreflight([taskId]);
  const item = preflight.tasks.find((task) => task.taskId === taskId);
  if (!item) {
    // No preflight entry means nothing established that this delete owns the
    // worktree, so do not ask for artifact removal even once confirmed.
    return {
      deleteWorktree: false,
      deleteBranch: false,
      branchKeptReason: keep(BRANCH_NOT_OWNED),
      gate: { reason: 'Emdash could not determine what deleting this task would remove.' },
    };
  }
  // Nothing to lose: either the task has no worktree of its own, or another task
  // still uses it and the delete leaves it in place.
  if (!item.hasWorktree) {
    return {
      deleteWorktree: false,
      deleteBranch: false,
      branchKeptReason: keep(BRANCH_NOT_OWNED),
      gate: null,
    };
  }

  // Branch removal needs every read below to succeed, so any failure on the way
  // keeps the branch and gates only the worktree.
  const unreachable = (reason: string): DeleteDecision => ({
    deleteWorktree: true,
    deleteBranch: false,
    branchKeptReason: keep(`Emdash could not check the task branch (${reason}).`),
    gate: { reason: `Emdash could not reach the task's worktree (${reason}).` },
  });
  const workspaceId = await resolveTaskWorkspaceId(dependencies, { projectId, taskId });
  if (!workspaceId.success) return unreachable(workspaceId.error);
  const runtime = await resolveWorkspaceRuntime(dependencies, workspaceId.data);
  if (!runtime.success) return unreachable(runtime.error);

  const branch =
    request.deleteBranch && item.hasDeletableBranch
      ? await findTaskBranch(dependencies, workspaceId.data)
      : null;
  const [changes, branchState] = await Promise.all([
    inspectWorktreeChanges(runtime.data),
    branch ? inspectBranchDeletion(runtime.data, branch) : null,
  ]);

  let deleteBranch = branchState !== null;
  let branchKeptReason = deleteBranch ? null : keep(BRANCH_NOT_OWNED);
  if (branch && branchState?.kind === 'not-checked-out') {
    deleteBranch = false;
    branchKeptReason = keep(
      `The worktree has ${branchState.current ?? 'no branch'} checked out instead of the ` +
        `task branch ${branch.name}, so Emdash left every branch in place.`
    );
  }

  const gates = [
    worktreeChangesGate(changes),
    branchState && deleteBranch ? branchDeletionGate(branchState) : null,
  ].filter((gate): gate is DeleteConfirmationGate => gate !== null);
  if (gates.length === 0) {
    return { deleteWorktree: true, deleteBranch, branchKeptReason, gate: null };
  }
  const merged = gates.reduce((all, gate) => ({ ...all, ...gate }));
  return {
    deleteWorktree: true,
    deleteBranch,
    branchKeptReason,
    gate: { ...merged, reason: gates.map((gate) => gate.reason).join(' ') },
  };
}

const projectIdInput = z.string().describe('Project id from list_projects');
const taskIdInput = z.string().describe('Task id from list_tasks or create_task');
const scriptTypeInput = z.enum(['setup', 'run', 'teardown']);

/**
 * Builds a fresh MCP server exposing Emdash's tools. One instance per request:
 * the HTTP transport runs in stateless mode.
 */
export function buildEmdashMcpServer(dependencies: McpToolDependencies): McpServer {
  const server = new McpServer({ name: 'emdash', version: dependencies.appVersion });
  const { db } = dependencies;

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Lists the projects registered in Emdash. Use the returned project id with create_task and list_tasks.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'list_projects', async () => {
      const rows = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(isNull(projects.deletedAt));
      return textResult(rows);
    })
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        `Lists tasks in an Emdash project, most recently updated first, up to ${MAX_LISTED_TASKS} ` +
        'of them. Archived tasks are left out unless you ask for them. When the result is ' +
        'truncated, do not assume a task you cannot see does not exist.',
      inputSchema: {
        projectId: projectIdInput,
        includeArchived: z
          .boolean()
          .optional()
          .describe('Include archived tasks in the list; defaults to false'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'list_tasks', async ({ projectId, includeArchived }) => {
      // Query directly instead of the task list service: that assembles
      // conversation and diff-stat aggregates this output never uses.
      const rows = await db
        .select({
          id: tasks.id,
          name: tasks.name,
          status: tasks.status,
          updatedAt: tasks.updatedAt,
          archivedAt: tasks.archivedAt,
          workspaceId: tasks.workspaceId,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            includeArchived === true ? undefined : isNull(tasks.archivedAt)
          )
        )
        .orderBy(desc(tasks.updatedAt))
        // One extra row is the cheapest way to know the list was cut short.
        .limit(MAX_LISTED_TASKS + 1);

      const truncated = rows.length > MAX_LISTED_TASKS;
      const projectTasks = truncated ? rows.slice(0, MAX_LISTED_TASKS) : rows;

      const workspaceIds = projectTasks
        .map((task) => task.workspaceId)
        .filter((id): id is string => Boolean(id));
      const workspaceRows = workspaceIds.length
        ? await db
            .select()
            .from(workspaces)
            .where(and(inArray(workspaces.id, workspaceIds), liveWorkspaces()))
        : [];
      const workspaceById = new Map(workspaceRows.map((row) => [row.id, row]));

      return textResult({
        tasks: projectTasks.map((task) => {
          const workspace = task.workspaceId ? workspaceById.get(task.workspaceId) : undefined;
          return {
            id: task.id,
            name: task.name,
            status: task.status,
            updatedAt: task.updatedAt,
            isArchived: task.archivedAt != null,
            branchName: workspace ? getProvisionedWorkspaceBranch(workspace) : null,
            workspacePath: workspace?.path ?? null,
          };
        }),
        truncated,
        ...(truncated
          ? {
              note:
                `Only the ${MAX_LISTED_TASKS} most recently updated tasks are shown. Older ` +
                'tasks exist but are not listed, so treat a missing task as unknown rather ' +
                'than absent.',
            }
          : {}),
      });
    })
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        'Creates a new Emdash task in an isolated git worktree. With a prompt, it also starts a ' +
        'coding agent on that prompt; without one, the task is left idle for the user to drive ' +
        'later. Returns the task id, branch name, and worktree path.',
      inputSchema: {
        projectId: projectIdInput,
        prompt: z
          .string()
          .optional()
          .describe(
            'The prompt the coding agent starts with. Omit to create the task without starting ' +
              'an agent. Some providers can only take a prompt in chat UI'
          ),
        name: z.string().optional().describe('Task name; generated when omitted'),
        provider: z
          .string()
          .optional()
          .describe(
            `Agent provider id (${validProviderIds()}); defaults to the app's default agent`
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Model id for the agent; must be one of the provider's selectable models. " +
              "Defaults to the provider CLI's default model in a terminal, or saved provider " +
              'settings in chat UI. Chat UI model overrides require a previously discovered ' +
              'provider model setting'
          ),
        branchName: z
          .string()
          .optional()
          .describe(
            'New branch name; must not already exist. Derived from the task name when omitted'
          ),
        baseBranch: z
          .string()
          .optional()
          .describe(
            "Existing branch to base the new task branch on; defaults to the project's " +
              'default branch'
          ),
        chatUi: z
          .boolean()
          .optional()
          .describe(
            'Start the conversation in the chat UI instead of a terminal (requires an ' +
              'ACP-capable provider); defaults to false'
          ),
        autoApprove: z
          .boolean()
          .optional()
          .describe(
            'Run the agent with permission prompts skipped, so it executes commands and edits ' +
              "without asking in terminal mode. Defaults to the provider's saved terminal setting, " +
              'and is ignored for chat UI and providers without an auto-approve mode. The response reports the ' +
              'value that was applied'
          ),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    guarded(dependencies, 'create_task', async (input) => {
      const result = await createTaskFromPrompt(dependencies, input);
      return result.success ? textResult(result.data) : errorResult(result.error);
    })
  );

  server.registerTool(
    'rename_task',
    {
      title: 'Rename task',
      description: 'Renames an Emdash task. Does not change its branch or worktree.',
      inputSchema: {
        projectId: projectIdInput,
        taskId: taskIdInput,
        name: z.string().describe('New task name'),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'rename_task', async ({ projectId, taskId, name }) => {
      const trimmed = name.trim();
      if (!trimmed) return errorResult('name must not be empty');
      const result = await dependencies.tasks.renameTask(projectId, taskId, trimmed);
      if (!result.success) {
        return errorResult(`Task not found in project ${projectId}: ${result.error.taskId}`);
      }
      return textResult({ taskId, name: result.data.task.name });
    })
  );

  server.registerTool(
    'archive_task',
    {
      title: 'Archive task',
      description:
        'Archives an Emdash task: stops its agent sessions but keeps the worktree and branch. ' +
        'Can be restored from the Emdash UI.',
      inputSchema: { projectId: projectIdInput, taskId: taskIdInput },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'archive_task', async ({ projectId, taskId }) => {
      const row = await findTaskInProject(dependencies, projectId, taskId);
      if (!row) return errorResult(`Task not found in project ${projectId}: ${taskId}`);

      // Attach the project so the archive's session teardown can actually reap
      // the task's live agent sessions instead of silently no-opping.
      const attached = await attachProject(dependencies.projects, projectId);
      try {
        await dependencies.tasks.archiveTask(projectId, taskId, dependencies.telemetry);
      } finally {
        if (attached.success) await attached.data.release();
      }
      return textResult({
        taskId,
        archived: true,
        ...(attached.success
          ? {}
          : {
              warning:
                'The project could not be opened, so any live agent sessions for this task were not stopped.',
            }),
      });
    })
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description:
        'Deletes an Emdash task, with the same options as the delete dialog in the Emdash UI: ' +
        'by default it removes the worktree and the task’s conversations and keeps the task ' +
        'branch. Pass deleteBranch: true only when the user asked for the branch to go too; ' +
        'only the local branch is deleted, never one on a remote. If the delete would lose ' +
        'uncommitted changes or unpushed commits, or Emdash cannot verify that it would not, ' +
        'the tool returns requiresConfirmation instead of deleting; get the user’s explicit ' +
        'approval, then retry with confirm: true.',
      inputSchema: {
        projectId: projectIdInput,
        taskId: taskIdInput,
        deleteWorktree: z
          .boolean()
          .optional()
          .describe(
            'Remove the task worktree from disk; defaults to true. False keeps the worktree and ' +
              'its branch and only deletes the task.'
          ),
        deleteBranch: z
          .boolean()
          .optional()
          .describe(
            'Also delete the local task branch; defaults to false. Only applies to a branch the ' +
              'task created, and only together with its worktree.'
          ),
        deleteConversations: z
          .boolean()
          .optional()
          .describe(
            'Delete the task’s conversations; defaults to true. False keeps them, unlinked ' +
              'from any task.'
          ),
        confirm: z
          .boolean()
          .optional()
          .describe(
            'Required (true) to delete a task when that would lose uncommitted changes or ' +
              'unpushed commits. Only set this after the user has explicitly approved losing ' +
              'that work; never set it preemptively.'
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'delete_task', async (input) => {
      const { projectId, taskId, confirm } = input;
      const request = {
        deleteWorktree: input.deleteWorktree ?? true,
        deleteBranch: input.deleteBranch ?? false,
      };
      const deleteConversations = input.deleteConversations ?? true;

      const row = await findTaskInProject(dependencies, projectId, taskId);
      if (!row) return errorResult(`Task not found in project ${projectId}: ${taskId}`);

      // Hold the attachment across both steps: the delete's session teardown
      // needs it, and it keeps the host runtime up for the git reads.
      const attached = await attachProject(dependencies.projects, projectId);
      if (!attached.success) return errorResult(attached.error);
      let decision: DeleteDecision;
      try {
        decision = await resolveDeleteDecision(dependencies, projectId, taskId, request);
        const { gate } = decision;
        if (gate && confirm !== true) {
          // An ordinary (non-error) result: the agent is expected to relay this
          // to its user and retry with confirm, not to treat it as a failure and
          // work around the check by touching the worktree itself.
          return textResult({
            taskId,
            deleted: false,
            requiresConfirmation: true,
            ...gate,
            instructions:
              'Ask the user to confirm deleting this task, then call delete_task again with ' +
              "confirm: true. Do not set confirm without the user's explicit approval, and do " +
              'not commit, discard, or delete anything in the worktree to get around this check.',
          });
        }

        await dependencies.tasks.deleteTask(projectId, taskId, {
          deleteWorktree: decision.deleteWorktree,
          deleteBranch: decision.deleteBranch,
          deleteConversations,
        });
      } finally {
        await attached.data.release();
      }
      // The task record and conversations go synchronously; worktree and branch
      // removal is best effort on the host, so report it as requested, not done.
      return textResult({
        taskId,
        deleted: true,
        conversationsDeleted: deleteConversations,
        worktreeRemovalRequested: decision.deleteWorktree,
        branchDeletionRequested: decision.deleteBranch,
        ...(decision.branchKeptReason ? { branchKeptReason: decision.branchKeptReason } : {}),
        ...(decision.deleteWorktree
          ? {
              note:
                'If removing the worktree fails on its host, it stays listed in the Emdash ' +
                'Workspaces view for removal there.',
            }
          : {}),
      });
    })
  );

  server.registerTool(
    'run_task_script',
    {
      title: 'Run task script',
      description:
        "Starts one of a task's configured worktree lifecycle scripts (setup, run, or teardown), " +
        'the same scripts the Scripts panel in the Emdash UI runs, and returns as soon as it has ' +
        'started rather than waiting for it to finish. Watch the Scripts panel for progress and ' +
        'stop a still-running script with stop_task_script. Reports already_running when a script ' +
        'of that type is already running, or no_script when none is configured for the type.',
      inputSchema: {
        projectId: projectIdInput,
        taskId: taskIdInput,
        type: scriptTypeInput.describe(
          'Which lifecycle script to run: setup (prepare the worktree), run (start the dev ' +
            'server), or teardown (clean up)'
        ),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    guarded(dependencies, 'run_task_script', async ({ projectId, taskId, type }) => {
      const result = await runTaskScript(dependencies, { projectId, taskId, type });
      return result.status === 'not_found' ? errorResult(result.message) : textResult(result);
    })
  );

  server.registerTool(
    'stop_task_script',
    {
      title: 'Stop task script',
      description:
        "Stops a task's running lifecycle script (setup, run, or teardown) started by " +
        'run_task_script, the same as clicking Stop in the Emdash Scripts panel. Reports ' +
        'not_running when no script of that type is currently running for the task.',
      inputSchema: {
        projectId: projectIdInput,
        taskId: taskIdInput,
        type: scriptTypeInput.describe('Which lifecycle script to stop'),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'stop_task_script', async ({ projectId, taskId, type }) => {
      const result = await stopTaskScript(dependencies, { projectId, taskId, type });
      return result.status === 'not_found' ? errorResult(result.message) : textResult(result);
    })
  );

  return server;
}
