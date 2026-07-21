import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { app } from 'electron';
import z from 'zod';
import { taskService } from '@main/core/tasks/task-service';
import { db } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import {
  createTaskFromPrompt,
  ensureProjectOpen,
  validProviderIds,
} from './create-task-from-prompt';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/**
 * The SDK forwards a thrown exception's message verbatim to the MCP client;
 * catch here so internal errors (db, git runtime) are logged but only a
 * generic message leaves the process.
 */
function guarded<Args extends unknown[]>(
  toolName: string,
  fn: (...args: Args) => Promise<ReturnType<typeof textResult> | ReturnType<typeof errorResult>>
) {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      log.error(`McpHttpServer: ${toolName} failed`, { error: String(error) });
      return errorResult(`emdash hit an internal error while handling ${toolName}`);
    }
  };
}

async function findTaskInProject(projectId: string, taskId: string) {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  return row;
}

/** Builds a fresh MCP server instance exposing emdash's tools (one per request in stateless HTTP mode). */
export function buildEmdashMcpServer(): McpServer {
  const server = new McpServer({ name: 'emdash', version: app.getVersion() });

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Lists the projects registered in emdash. Use the returned project id with create_task and list_tasks.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('list_projects', async () => {
      const rows = await db
        .select({ id: projects.id, name: projects.name, path: projects.path })
        .from(projects);
      return textResult(rows);
    })
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description: 'Lists tasks in an emdash project, most recently updated first.',
      inputSchema: {
        projectId: z.string().describe('Project id from list_projects'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('list_tasks', async ({ projectId }) => {
      // Query directly instead of taskService.getTasks(): that fetches every
      // task plus conversation/diff-stat aggregates the tool output never uses.
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
        .where(eq(tasks.projectId, projectId))
        .orderBy(desc(tasks.updatedAt))
        .limit(50);
      const workspaceIds = projectTasks
        .map((task) => task.workspaceId)
        .filter((id): id is string => Boolean(id));
      const workspaceRows = workspaceIds.length
        ? await db
            .select({ id: workspaces.id, path: workspaces.path, branchName: workspaces.branchName })
            .from(workspaces)
            .where(inArray(workspaces.id, workspaceIds))
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
            branchName: workspace?.branchName ?? null,
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
        'Creates a new emdash task in an isolated git worktree and starts a coding agent on the given prompt. ' +
        'Returns the task id, branch name, and worktree path.',
      inputSchema: {
        projectId: z.string().describe('Project id from list_projects'),
        prompt: z.string().describe('The prompt the coding agent starts with'),
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
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    guarded('create_task', async (input) => {
      const result = await createTaskFromPrompt(input);
      if (!result.success) return errorResult(result.error);
      return textResult(result.data);
    })
  );

  server.registerTool(
    'archive_task',
    {
      title: 'Archive task',
      description:
        'Archives an emdash task: stops its agent sessions but keeps the worktree and branch. ' +
        'Can be restored from the emdash UI.',
      inputSchema: {
        projectId: z.string().describe('Project id from list_projects'),
        taskId: z.string().describe('Task id from list_tasks or create_task'),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded('archive_task', async ({ projectId, taskId }) => {
      const row = await findTaskInProject(projectId, taskId);
      if (!row) return errorResult(`Task not found in project ${projectId}: ${taskId}`);
      // Open the project so archiveTask's session teardown can actually reap
      // the task's live agent/tmux sessions instead of silently no-opping.
      const project = await ensureProjectOpen(projectId);
      await taskService.archiveTask(projectId, taskId);
      return textResult({
        taskId,
        archived: true,
        ...(project
          ? {}
          : {
              warning:
                'The project could not be opened, so any live agent sessions for this task were not stopped.',
            }),
      });
    })
  );

  server.registerTool(
    'rename_task',
    {
      title: 'Rename task',
      description: 'Renames an emdash task. Does not change its branch or worktree.',
      inputSchema: {
        projectId: z.string().describe('Project id from list_projects'),
        taskId: z.string().describe('Task id from list_tasks or create_task'),
        name: z.string().describe('New task name'),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded('rename_task', async ({ projectId, taskId, name }) => {
      const trimmed = name.trim();
      if (!trimmed) return errorResult('name must not be empty');
      const result = await taskService.renameTask(projectId, taskId, trimmed);
      if (!result.success) {
        return errorResult(`Task not found in project ${projectId}: ${result.error.taskId}`);
      }
      return textResult({ taskId, name: result.data.task.name });
    })
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description:
        'Deletes an emdash task and removes its worktree. The task branch is always kept, so ' +
        'committed work stays recoverable. If the worktree has uncommitted changes the tool ' +
        'returns requiresConfirmation instead of deleting; get the user’s explicit approval, ' +
        'then retry with confirm: true.',
      inputSchema: {
        projectId: z.string().describe('Project id from list_projects'),
        taskId: z.string().describe('Task id from list_tasks or create_task'),
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
    guarded('delete_task', async ({ projectId, taskId, confirm }) => {
      const row = await findTaskInProject(projectId, taskId);
      if (!row) return errorResult(`Task not found in project ${projectId}: ${taskId}`);

      // The uncommitted-changes preflight needs the project's git runtime; fail
      // closed rather than delete a worktree whose state could not be verified.
      const project = await ensureProjectOpen(projectId);
      if (!project) {
        return errorResult(`Project ${projectId} could not be opened to verify worktree state`);
      }
      const preflight = await taskService.getDeletePreflight(projectId, [taskId]);
      const item = preflight.tasks.find((task) => task.taskId === taskId);
      if (item?.hasUncommittedChanges && confirm !== true) {
        // A normal (non-error) result: the agent is expected to relay this to
        // its user and retry with confirm, not to treat it as a failure and
        // work around the check by touching the worktree itself.
        return textResult({
          taskId,
          deleted: false,
          requiresConfirmation: true,
          reason: 'The task worktree has uncommitted changes that will be permanently lost.',
          instructions:
            'Ask the user to confirm deleting this task, then call delete_task again with ' +
            "confirm: true. Do not set confirm without the user's explicit approval, and do " +
            'not commit, discard, or delete anything in the worktree to get around this check.',
        });
      }

      await taskService.deleteTask(projectId, taskId, {
        deleteWorktree: true,
        deleteBranch: false,
      });
      return textResult({ taskId, deleted: true, branchKept: true });
    })
  );

  return server;
}
