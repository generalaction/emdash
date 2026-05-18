/**
 * Registers the `task.*` MCP tools.
 *
 * These are thin adapters over the existing operation functions in
 * `src/main/core/tasks/operations/` and the `pty-session-registry`. No
 * business logic lives here — every tool either:
 *
 * 1. Validates args with Zod (the SDK enforces this from the registered
 *    `inputSchema`).
 * 2. Calls a single existing op or registry method.
 * 3. Translates the result into the MCP reply shape via `formatOk` /
 *    `formatErr` / `fromResult`.
 *
 * Wired ops (one-line audit, kept here so future readers can `git grep` to
 * the source):
 *
 *   task.create       → `createTask`           (operations/createTask.ts)
 *   task.list         → `getTasks`             (operations/getTasks.ts)
 *   task.get          → `getTasks` + filter    (no per-id op exists today)
 *   task.update       → renameTask / updateTaskStatus / updateLinkedIssue
 *                       / setTaskPinned        (operations/*.ts)
 *   task.delete       → `deleteTask`           (operations/deleteTask.ts)
 *   task.archive      → `archiveTask`          (operations/archiveTask.ts)
 *   task.unarchive    → `restoreTask`          (operations/restoreTask.ts)
 *   task.sendInput    → `pty.write`            (pty/pty-session-registry.ts)
 *   task.getOutput    → `ringBuffer peek`     (pty/pty-session-registry.ts) — uses
 *                       `peek()` rather than `subscribe()` to avoid leaking
 *                       an active-consumer registration (see T4 review).
 *   task.listSessions → `listActiveSessions`   (pty/pty-session-registry.ts)
 *   task.openInIDE    → `appService.openIn`    (app/service.ts)
 *
 * Implementation note — runtime deps are loaded lazily inside `loadDeps()`
 * so that simply *constructing* an `McpServer` (e.g. in
 * `http-server.test.ts`) does not pull in the database client, Electron, or
 * the rest of the main-process surface area. The first tool invocation pays
 * a one-time import cost; subsequent calls hit the cached module.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskStrategy,
  CreateTaskSuccess,
  Issue,
  RenameTaskError,
  RenameTaskSuccess,
  Task,
  TaskLifecycleStatus,
} from '@shared/tasks';
import type { appService as AppService } from '@main/core/app/service';
// `type`-only imports below pull from the original source modules. They are
// erased at runtime, so they do NOT trigger the eager module evaluation
// (Electron / `@main/db/client`) that we are deliberately deferring with the
// dynamic `import()` inside `loadDeps()`.
import type { ptySessionRegistry as PtySessionRegistry } from '@main/core/pty/pty-session-registry';
import type { workspaceRegistry as WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import {
  editorSchema,
  editorToOpenInAppId,
  formatErr,
  formatOk,
  fromResult,
  requireConfirm,
  withRecording,
  type McpToolReply,
} from './_helpers';

// ─── Lazy deps ────────────────────────────────────────────────────────────
/**
 * Imports every runtime dependency on first use. Keeping this off the
 * module's top-level imports lets `createMcpServer()` run in environments
 * (tests, the bridge stub) where Electron / `@main/db/client` would crash
 * at import time.
 */
type TaskDeps = {
  createTask: (params: CreateTaskParams) => Promise<Result<CreateTaskSuccess, CreateTaskError>>;
  getTasks: (projectId?: string) => Promise<Task[]>;
  deleteTask: (projectId: string, taskId: string) => Promise<void>;
  archiveTask: (projectId: string, taskId: string) => Promise<void>;
  restoreTask: (taskId: string) => Promise<void>;
  renameTask: (
    projectId: string,
    taskId: string,
    newName: string
  ) => Promise<Result<RenameTaskSuccess, RenameTaskError>>;
  updateTaskStatus: (taskId: string, status: TaskLifecycleStatus) => Promise<void>;
  updateLinkedIssue: (taskId: string, issue?: Issue) => Promise<unknown>;
  setTaskPinned: (taskId: string, isPinned: boolean) => Promise<void>;
  ptySessionRegistry: typeof PtySessionRegistry;
  workspaceRegistry: typeof WorkspaceRegistry;
  appService: typeof AppService;
};

let cachedDeps: TaskDeps | null = null;
let cachedDepsPromise: Promise<TaskDeps> | null = null;

async function loadDeps(): Promise<TaskDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const [
      createTaskMod,
      getTasksMod,
      deleteTaskMod,
      archiveTaskMod,
      restoreTaskMod,
      renameTaskMod,
      updateTaskStatusMod,
      updateLinkedIssueMod,
      setTaskPinnedMod,
      ptyRegistryMod,
      workspaceRegistryMod,
      appServiceMod,
    ] = await Promise.all([
      import('@main/core/tasks/operations/createTask'),
      import('@main/core/tasks/operations/getTasks'),
      import('@main/core/tasks/operations/deleteTask'),
      import('@main/core/tasks/operations/archiveTask'),
      import('@main/core/tasks/operations/restoreTask'),
      import('@main/core/tasks/operations/renameTask'),
      import('@main/core/tasks/operations/updateTaskStatus'),
      import('@main/core/tasks/operations/updateLinkedIssue'),
      import('@main/core/tasks/operations/setTaskPinned'),
      import('@main/core/pty/pty-session-registry'),
      import('@main/core/workspaces/workspace-registry'),
      import('@main/core/app/service'),
    ]);
    cachedDeps = {
      createTask: createTaskMod.createTask,
      getTasks: getTasksMod.getTasks,
      deleteTask: deleteTaskMod.deleteTask,
      archiveTask: archiveTaskMod.archiveTask,
      restoreTask: restoreTaskMod.restoreTask,
      renameTask: renameTaskMod.renameTask,
      updateTaskStatus: updateTaskStatusMod.updateTaskStatus,
      updateLinkedIssue: updateLinkedIssueMod.updateLinkedIssue,
      setTaskPinned: setTaskPinnedMod.setTaskPinned,
      ptySessionRegistry: ptyRegistryMod.ptySessionRegistry,
      workspaceRegistry: workspaceRegistryMod.workspaceRegistry,
      appService: appServiceMod.appService,
    };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — for tests: inject a ready-made deps object. */
export function _setTaskDeps(deps: TaskDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — for tests: clear cached deps. */
export function _resetTaskDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

// ─── Zod fragments ────────────────────────────────────────────────────────

const taskLifecycleStatusSchema = z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']);

const branchSchema = z.union([
  z.object({
    type: z.literal('local'),
    branch: z.string(),
    remote: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('remote'),
    branch: z.string(),
    remote: z.unknown(),
  }),
]);

const issueSchema = z.object({
  provider: z.enum(['github', 'linear', 'jira', 'gitlab', 'plain', 'forgejo', 'featurebase']),
  url: z.string(),
  title: z.string(),
  identifier: z.string(),
  description: z.string().optional(),
  branchName: z.string().optional(),
  status: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  project: z.string().optional(),
  updatedAt: z.string().optional(),
  fetchedAt: z.string().optional(),
});

const taskCreateStrategyKindSchema = z.enum([
  'new-branch',
  'checkout-existing',
  'from-pull-request',
  'no-worktree',
]);

// ─── Tool registration ────────────────────────────────────────────────────

export function registerTaskTools(server: McpServer): void {
  // task.create ────────────────────────────────────────────────────────────
  const createInput = {
    projectId: z.string(),
    name: z.string(),
    sourceBranch: branchSchema.optional(),
    taskBranch: z.string().optional(),
    strategy: taskCreateStrategyKindSchema.optional(),
    provision: z.boolean().optional(),
  };
  server.registerTool(
    'task.create',
    {
      title: 'Create task',
      description:
        'Create a new task in a project. Provisions a worktree and PTY by default. ' +
        'Returns the created task summary.',
      inputSchema: createInput,
    },
    withRecording('task.create', async (args: z.infer<z.ZodObject<typeof createInput>>) => {
      const strategyKind = args.strategy ?? 'new-branch';
      // Default the source branch to a generic local "main" when none is
      // given. The op rejects unknown branches with `branch-not-found`,
      // so callers should normally pass an explicit `sourceBranch`.
      const sourceBranch = args.sourceBranch ?? { type: 'local', branch: 'main' };

      let strategy: CreateTaskStrategy;
      switch (strategyKind) {
        case 'new-branch':
          strategy = { kind: 'new-branch', taskBranch: args.taskBranch ?? args.name };
          break;
        case 'checkout-existing':
          strategy = { kind: 'checkout-existing' };
          break;
        case 'no-worktree':
          strategy = { kind: 'no-worktree' };
          break;
        case 'from-pull-request':
          // The op needs a PR number + head metadata that the LLM cannot
          // synthesise from `task.create` alone. Direct callers should use
          // the renderer flow for now.
          return formatErr(
            'STRATEGY_NOT_SUPPORTED',
            "task.create does not support strategy 'from-pull-request' yet — call this from the UI instead.",
            { strategy: strategyKind }
          );
      }

      const params: CreateTaskParams = {
        id: randomUUID(),
        projectId: args.projectId,
        name: args.name,
        sourceBranch: sourceBranch as CreateTaskParams['sourceBranch'],
        strategy,
      };
      const deps = await loadDeps();
      const result = await deps.createTask(params);
      return fromResult(result);
    }) as never
  );

  // task.list ──────────────────────────────────────────────────────────────
  const listInput = {
    projectId: z.string(),
    status: taskLifecycleStatusSchema.optional(),
    includeArchived: z.boolean().optional(),
  };
  server.registerTool(
    'task.list',
    {
      title: 'List tasks',
      description: 'List tasks in a project, optionally filtered by status / archived state.',
      inputSchema: listInput,
    },
    withRecording('task.list', async (args: z.infer<z.ZodObject<typeof listInput>>) => {
      const deps = await loadDeps();
      const all = await deps.getTasks(args.projectId);
      const filtered = all.filter((t) => {
        if (!args.includeArchived && t.archivedAt) return false;
        if (args.status && t.status !== args.status) return false;
        return true;
      });
      return formatOk(filtered);
    }) as never
  );

  // task.get ───────────────────────────────────────────────────────────────
  const getInput = { taskId: z.string() };
  server.registerTool(
    'task.get',
    {
      title: 'Get task',
      description: 'Fetch full task detail by id.',
      inputSchema: getInput,
    },
    withRecording('task.get', async (args: z.infer<z.ZodObject<typeof getInput>>) => {
      const deps = await loadDeps();
      // No per-id op exists today; filter the project-wide listing. We don't
      // know the project id, so fall back to listing across all projects.
      const all = await deps.getTasks();
      const found = all.find((t) => t.id === args.taskId);
      if (!found) {
        return formatErr('NOT_FOUND', `Task not found: ${args.taskId}`, { taskId: args.taskId });
      }
      return formatOk(found);
    }) as never
  );

  // task.update ────────────────────────────────────────────────────────────
  const updateInput = {
    taskId: z.string(),
    patch: z
      .object({
        name: z.string().optional(),
        status: taskLifecycleStatusSchema.optional(),
        // sourceBranch updates are intentionally not supported: there is no
        // existing operation function for them. Tracked for follow-up.
        linkedIssue: issueSchema.optional(),
        isPinned: z.boolean().optional(),
      })
      .strict(),
  };
  server.registerTool(
    'task.update',
    {
      title: 'Update task',
      description:
        'Patch task fields (name, status, linkedIssue, isPinned). ' +
        'Each field maps to a dedicated emdash operation; multiple fields are applied in series.',
      inputSchema: updateInput,
    },
    withRecording('task.update', async (args: z.infer<z.ZodObject<typeof updateInput>>) => {
      const { taskId, patch } = args;
      const deps = await loadDeps();
      // We need projectId for renameTask; fetch it from the task row via
      // getTasks (matches `task.get`'s lookup pattern).
      const allTasks = await deps.getTasks();
      const target = allTasks.find((t) => t.id === taskId);
      if (!target) {
        return formatErr('NOT_FOUND', `Task not found: ${taskId}`, { taskId });
      }

      // Apply ops in a stable order; bail on the first one that returns Err.
      // Each op already emits `task:updated`, which is the desired side
      // effect — the renderer / MCP resource layer reacts.
      if (patch.status !== undefined) {
        await deps.updateTaskStatus(taskId, patch.status as TaskLifecycleStatus);
      }
      if (patch.isPinned !== undefined) {
        await deps.setTaskPinned(taskId, patch.isPinned);
      }
      if (patch.linkedIssue !== undefined) {
        await deps.updateLinkedIssue(taskId, patch.linkedIssue);
      }
      if (patch.name !== undefined) {
        const renameResult = await deps.renameTask(target.projectId, taskId, patch.name);
        if (!renameResult.success) return fromResult(renameResult);
      }

      // Return the freshly-applied state.
      const refreshed = (await deps.getTasks()).find((t) => t.id === taskId);
      return formatOk(refreshed ?? null);
    }) as never
  );

  // task.delete ────────────────────────────────────────────────────────────
  const deleteInput = {
    taskId: z.string(),
    confirm: z.boolean().optional(),
  };
  server.registerTool(
    'task.delete',
    {
      title: 'Delete task',
      description:
        'Hard-delete a task and tear down its workspace. Destructive — requires confirm: true.',
      inputSchema: deleteInput,
    },
    withRecording('task.delete', async (args: z.infer<z.ZodObject<typeof deleteInput>>) => {
      const guard = requireConfirm(args, 'delete this task', { taskId: args.taskId });
      if (guard) return guard;
      const deps = await loadDeps();
      const all = await deps.getTasks();
      const target = all.find((t) => t.id === args.taskId);
      if (!target) {
        return formatErr('NOT_FOUND', `Task not found: ${args.taskId}`, { taskId: args.taskId });
      }
      await deps.deleteTask(target.projectId, args.taskId);
      return formatOk({ taskId: args.taskId, deleted: true });
    }) as never
  );

  // task.archive ───────────────────────────────────────────────────────────
  const archiveInput = { taskId: z.string() };
  server.registerTool(
    'task.archive',
    {
      title: 'Archive task',
      description: 'Soft-delete (archive) a task. Reversible via task.unarchive.',
      inputSchema: archiveInput,
    },
    withRecording('task.archive', async (args: z.infer<z.ZodObject<typeof archiveInput>>) => {
      const deps = await loadDeps();
      const all = await deps.getTasks();
      const target = all.find((t) => t.id === args.taskId);
      if (!target) {
        return formatErr('NOT_FOUND', `Task not found: ${args.taskId}`, { taskId: args.taskId });
      }
      await deps.archiveTask(target.projectId, args.taskId);
      return formatOk({ taskId: args.taskId, archived: true });
    }) as never
  );

  // task.unarchive ─────────────────────────────────────────────────────────
  server.registerTool(
    'task.unarchive',
    {
      title: 'Unarchive task',
      description: 'Restore a previously-archived task.',
      inputSchema: archiveInput,
    },
    withRecording('task.unarchive', async (args: z.infer<z.ZodObject<typeof archiveInput>>) => {
      const deps = await loadDeps();
      await deps.restoreTask(args.taskId);
      return formatOk({ taskId: args.taskId, archived: false });
    }) as never
  );

  // task.sendInput ─────────────────────────────────────────────────────────
  const sendInput = {
    taskId: z.string(),
    sessionId: z.string(),
    data: z.string(),
    appendEnter: z.boolean().optional(),
  };
  server.registerTool(
    'task.sendInput',
    {
      title: 'Send input to PTY session',
      description:
        'Write a string to a running PTY session for the given task. ' +
        'Set appendEnter: true to append a newline (most agents need this to submit).',
      inputSchema: sendInput,
    },
    withRecording('task.sendInput', async (args: z.infer<z.ZodObject<typeof sendInput>>) => {
      const deps = await loadDeps();
      const pty = deps.ptySessionRegistry.get(args.sessionId);
      if (!pty) {
        return formatErr('NOT_FOUND', `PTY session not found: ${args.sessionId}`, {
          sessionId: args.sessionId,
        });
      }
      const payload = args.appendEnter ? `${args.data}\n` : args.data;
      pty.write(payload);
      return formatOk({ sessionId: args.sessionId, bytesWritten: payload.length });
    }) as never
  );

  // task.getOutput ─────────────────────────────────────────────────────────
  const outputInput = {
    taskId: z.string(),
    sessionId: z.string(),
    sinceCursor: z.number().int().nonnegative().optional(),
    bytes: z.number().int().positive().optional(),
  };
  server.registerTool(
    'task.getOutput',
    {
      title: 'Read PTY ring buffer',
      description:
        'Snapshot a PTY session ring buffer. Pass sinceCursor (received from a prior call) ' +
        'to get only new output. Returns { data, cursor, eof }. Note the buffer is bounded ' +
        'at 64 KB per session — long-running output may be truncated.',
      inputSchema: outputInput,
    },
    withRecording('task.getOutput', async (args: z.infer<z.ZodObject<typeof outputInput>>) => {
      const deps = await loadDeps();
      // `peek` returns the ring buffer WITHOUT registering an IPC consumer —
      // every MCP call would otherwise leak one into `activeConsumers`.
      const buffer = deps.ptySessionRegistry.peek(args.sessionId);
      const eof = deps.ptySessionRegistry.get(args.sessionId) === undefined;
      // The registry buffer is a string; `cursor` is the byte length of the
      // delivered slice — clients pass the value back as `sinceCursor` to
      // resume.
      const sliceFrom =
        typeof args.sinceCursor === 'number' && args.sinceCursor < buffer.length
          ? args.sinceCursor
          : 0;
      let slice = buffer.slice(sliceFrom);
      if (typeof args.bytes === 'number' && slice.length > args.bytes) {
        slice = slice.slice(0, args.bytes);
      }
      return formatOk({
        data: slice,
        cursor: sliceFrom + slice.length,
        eof,
      });
    }) as never
  );

  // task.listSessions ──────────────────────────────────────────────────────
  const listSessionsInput = { taskId: z.string() };
  server.registerTool(
    'task.listSessions',
    {
      title: 'List PTY sessions for a task',
      description: 'List active PTY sessions associated with a task and their status.',
      inputSchema: listSessionsInput,
    },
    withRecording(
      'task.listSessions',
      async (args: z.infer<z.ZodObject<typeof listSessionsInput>>) => {
        const deps = await loadDeps();
        // Session IDs are formatted `<projectId>:<scopeId>:<leafId>` — the
        // task id is the scopeId. Filter the active list to those whose
        // scope matches.
        const sessions = deps.ptySessionRegistry.listActiveSessions().filter((s) => {
          const parts = s.sessionId.split(':');
          return parts[1] === args.taskId;
        });
        return formatOk(
          sessions.map((s) => ({
            sessionId: s.sessionId,
            pid: s.pid,
            metadata: s.metadata,
            status: 'running' as const,
          }))
        );
      }
    ) as never
  );

  // task.openInIDE ─────────────────────────────────────────────────────────
  const openInIdeInput = {
    taskId: z.string(),
    editor: editorSchema,
  };
  server.registerTool(
    'task.openInIDE',
    {
      title: 'Open task workspace in editor',
      description:
        "Open the task's worktree in a configured editor (vscode | cursor | zed | sublime | terminal).",
      inputSchema: openInIdeInput,
    },
    withRecording('task.openInIDE', async (args: z.infer<z.ZodObject<typeof openInIdeInput>>) => {
      const deps = await loadDeps();
      const all = await deps.getTasks();
      const target = all.find((t) => t.id === args.taskId);
      if (!target) {
        return formatErr('NOT_FOUND', `Task not found: ${args.taskId}`, { taskId: args.taskId });
      }
      if (!target.workspaceId) {
        return formatErr('NOT_PROVISIONED', 'Task has no workspace', { taskId: args.taskId });
      }
      const ws = deps.workspaceRegistry.get(target.workspaceId);
      if (!ws) {
        return formatErr(
          'WORKSPACE_NOT_READY',
          'Workspace is not currently mounted; provision the task first.',
          { workspaceId: target.workspaceId }
        );
      }
      const appId = editorToOpenInAppId[args.editor];
      await deps.appService.openIn({ app: appId, path: ws.path });
      return formatOk({ taskId: args.taskId, editor: args.editor, path: ws.path });
    }) as never
  );
}

// Re-export under the conventional `register` name so `tools/index.ts` can
// import a uniform symbol per file in T5+ when it grows.
export { registerTaskTools as register };

/**
 * Internal helper exposed for tests so they can drive the Result-returning
 * branch of `fromResult` without spinning up a real op. Not part of the
 * public surface — do not import from outside `mcp-server/tools`.
 *
 * @internal
 */
export function _testWrapResult<T, E>(r: Result<T, E>): McpToolReply {
  return fromResult(r);
}
