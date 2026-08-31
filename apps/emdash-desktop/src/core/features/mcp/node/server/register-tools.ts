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
      description: 'Lists tasks in an Emdash project, most recently updated first.',
      inputSchema: { projectId: projectIdInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'list_tasks', async ({ projectId }) => {
      // Query directly instead of the task list service: that assembles
      // conversation and diff-stat aggregates this output never uses.
      const projectTasks = await db
        .select({
          id: tasks.id,
          name: tasks.name,
          status: tasks.status,
          updatedAt: tasks.updatedAt,
          archivedAt: tasks.archivedAt,
          workspaceId: tasks.workspaceId,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.updatedAt))
        .limit(MAX_LISTED_TASKS);

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

      return textResult(
        projectTasks.map((task) => {
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
        })
      );
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
              'an agent'
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
              "Defaults to the provider CLI's default model"
          ),
        branchName: z
          .string()
          .optional()
          .describe('Branch name; derived from the task name when omitted'),
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
              'ACP-capable provider); defaults to false, matching the new-task modal'
          ),
        autoApprove: z
          .boolean()
          .optional()
          .describe(
            'Run the agent with permission prompts skipped, so it executes commands and edits ' +
              "without asking. Defaults to the app's auto-approve-by-default task setting, and " +
              'is ignored for providers without an auto-approve mode. The response reports the ' +
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
        'Deletes an Emdash task and removes its worktree. The task branch is always kept, so ' +
        'committed work stays recoverable. If the worktree has uncommitted changes the tool ' +
        'returns requiresConfirmation instead of deleting; get the user’s explicit approval, ' +
        'then retry with confirm: true.',
      inputSchema: {
        projectId: projectIdInput,
        taskId: taskIdInput,
        confirm: z
          .boolean()
          .optional()
          .describe(
            'Required (true) to delete a task whose worktree has uncommitted changes. Only set ' +
              'this after the user has explicitly approved losing those changes; never set it ' +
              'preemptively.'
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    guarded(dependencies, 'delete_task', async ({ projectId, taskId, confirm }) => {
      const row = await findTaskInProject(dependencies, projectId, taskId);
      if (!row) return errorResult(`Task not found in project ${projectId}: ${taskId}`);

      // The preflight reads dirty state from the workspace mirror, which is only
      // fresh while the host is attached; fail closed rather than delete a
      // worktree whose state could not be verified.
      const attached = await attachProject(dependencies.projects, projectId);
      if (!attached.success) return errorResult(attached.error);
      try {
        const preflight = await dependencies.tasks.getDeletePreflight([taskId]);
        const item = preflight.tasks.find((task) => task.taskId === taskId);
        if (item?.hasUncommittedChanges && confirm !== true) {
          // An ordinary (non-error) result: the agent is expected to relay this
          // to its user and retry with confirm, not to treat it as a failure and
          // work around the check by touching the worktree itself.
          return textResult({
            taskId,
            deleted: false,
            requiresConfirmation: true,
            reason: 'The task worktree has uncommitted changes that will be permanently lost.',
            changedLines: item.changedLines ?? null,
            unpushedCommits: item.unpushedCommits ?? null,
            instructions:
              'Ask the user to confirm deleting this task, then call delete_task again with ' +
              "confirm: true. Do not set confirm without the user's explicit approval, and do " +
              'not commit, discard, or delete anything in the worktree to get around this check.',
          });
        }

        await dependencies.tasks.deleteTask(projectId, taskId, {
          deleteWorktree: true,
          deleteBranch: false,
        });
      } finally {
        await attached.data.release();
      }
      return textResult({ taskId, deleted: true, branchKept: true });
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
