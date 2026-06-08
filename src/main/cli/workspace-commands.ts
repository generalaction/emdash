/**
 * Core (db-injected, Electron-free) implementations of the `emdash workspace`
 * CLI command group. Kept free of eager db-bound singletons so it can be unit
 * tested against a temp SQLite database via `openFixture`.
 *
 * `createWorkspace` reuses the same git/worktree services and the same
 * key-hash logic the app uses, so the rows + worktree it produces are
 * indistinguishable from a UI-created workspace.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { GitService } from '@main/core/git/impl/git-service';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { fromStoredBranch, toStoredBranch } from '@main/core/tasks/stored-branch';
import { computeWorkspaceKey } from '@main/core/workspaces/workspace-key';
import type { AppDb } from '@main/db/client';
import { conversations, projects, tasks, workspaces } from '@main/db/schema';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import { serializeConversationConfig } from '@shared/conversation-config';
import type { Branch } from '@shared/git';
import { makePtySessionId } from '@shared/ptySessionId';
import type { AgentDispatchResult } from './agent-dispatch';
import { buildLocalWorktreeContext, type LocalWorktreeContext } from './local-worktree';

/**
 * Launches the agent for a freshly-created conversation. Injected by the CLI
 * entry (which resolves provider config + env); tests pass a fake. Returns
 * whether the agent session is up and whether the prompt was delivered.
 */
export type CreateAgentDispatcher = (args: {
  projectId: string;
  taskId: string;
  conversationId: string;
  providerId: AgentProviderId;
  autoApprove: boolean;
  prompt: string;
  cwd: string;
}) => Promise<AgentDispatchResult>;

export type WorkspaceStrategy = 'new-branch' | 'checkout-existing' | 'no-worktree';

export type ResolvedProject = {
  id: string;
  name: string;
  path: string;
  baseRef: string;
};

export type CreateWorkspaceOptions = {
  project: ResolvedProject;
  /** Required for worktree strategies; ignored for `no-worktree`. */
  branch?: string;
  /** Source branch to fork from (defaults to the project's base ref). */
  base?: string;
  /** Task display name (defaults to the branch name). */
  name?: string;
  strategy?: WorkspaceStrategy;
  /** Resolved worktree pool directory. Falls back to `settings` when omitted. */
  worktreeDirectory?: string;
  /** Real project settings (production) for parity; optional in tests. */
  settings?: ProjectSettingsProvider;
  /** Initial prompt — when set, launches the agent and seeds it (one-shot dispatch). */
  prompt?: string;
  /** Agent provider id (defaults to `claude`). */
  agent?: string;
  /** Launch the agent with permissions auto-approved. */
  autoApprove?: boolean;
  /** Publish the new branch to the push remote after creating the worktree. */
  pushBranch?: boolean;
  /** Agent launcher (injected by the entry; required when `prompt` is set). */
  dispatch?: CreateAgentDispatcher;
};

export type CreateWorkspaceResult = {
  workspaceId: string;
  taskId: string;
  branch: string | null;
  path: string;
  key: string | null;
  type: 'local';
  /** True when an existing workspace for this branch was returned unchanged. */
  reused: boolean;
  /** Agent provider id (when --prompt launched one). */
  agent?: string;
  /** Conversation id of the launched agent session. */
  conversationId?: string;
  /** Whether the initial prompt was delivered to the agent. */
  promptDelivered?: boolean;
  /** Whether the branch was pushed (when --push-branch). */
  pushed?: boolean;
  /** Non-fatal warning (e.g. tmux mode off → the app won't adopt the dispatched agent). */
  warning?: string;
};

export type WorkspaceListItem = {
  id: string;
  type: string;
  branch: string | null;
  project: string | null;
  path: string | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  archived: boolean;
  createdAt: string;
};

export type ListWorkspacesOptions = {
  /** Filter by project name or id (case-insensitive). */
  project?: string;
  includeArchived?: boolean;
};

export type RemoveWorkspaceOptions = {
  project: ResolvedProject;
  /** Target by branch (the create counterpart) … */
  branch?: string;
  /** … or by workspace id. */
  id?: string;
  /** Command run in the worktree before teardown (capture-before-delete). */
  preRemoveCmd?: string;
  /** Skip the pre-remove hook entirely. */
  skipHook?: boolean;
  /** Proceed with teardown even if the hook fails / force-remove the worktree. */
  force?: boolean;
  worktreeDirectory?: string;
  settings?: ProjectSettingsProvider;
};

export type RemoveWorkspaceResult = {
  workspaceId: string | null;
  branch: string | null;
  hookRan: boolean;
  removedWorktree: boolean;
  removedBranch: boolean;
  /** Branch kept (not deleted) because it has unmerged commits; pass --force to delete. */
  branchRetained?: 'unmerged';
  deletedTasks: number;
  deletedWorkspace: boolean;
  /** Nothing matched — already torn down (idempotent no-op). */
  alreadyGone: boolean;
};

/**
 * Resolves a project by id or (case-insensitive) name. Throws a descriptive
 * error when nothing matches or a name is ambiguous.
 */
export async function resolveProject(db: AppDb, nameOrId: string): Promise<ResolvedProject> {
  const rows = await db.select().from(projects);
  const matches = rows.filter(
    (r) => r.id === nameOrId || r.name.toLowerCase() === nameOrId.toLowerCase()
  );
  if (matches.length === 0) {
    throw new Error(`Project not found: ${nameOrId}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous project "${nameOrId}" — matches ${matches.length} projects; pass the project id instead.`
    );
  }
  const row = matches[0]!;
  if (row.workspaceProvider !== 'local') {
    throw new Error(
      `Project "${row.name}" is not a local project (CLI supports local projects only).`
    );
  }
  return { id: row.id, name: row.name, path: row.path, baseRef: row.baseRef ?? 'main' };
}

/**
 * Resolves a base ref string (which may be local like `main`, or remote like
 * `origin/main`) into a typed `Branch`. This is what lets `create` fork from a
 * remote default branch — the common real-world case where there's no local
 * branch of that name.
 */
async function resolveBaseBranch(repoGit: GitService, base: string): Promise<Branch> {
  const trimmed = base.trim();

  const remotes = await repoGit.getRemotes().catch(() => []);
  for (const remote of remotes) {
    if (trimmed.startsWith(`${remote.name}/`)) {
      return {
        type: 'remote',
        branch: trimmed.slice(remote.name.length + 1),
        remote: { name: remote.name, url: remote.url },
      };
    }
  }

  const branches = await repoGit.getBranches().catch(() => []);
  if (branches.some((b) => b.type === 'local' && b.branch === trimmed)) {
    return { type: 'local', branch: trimmed };
  }
  const remoteMatch = branches.find((b) => b.type === 'remote' && b.branch === trimmed);
  if (remoteMatch && remoteMatch.type === 'remote') {
    return { type: 'remote', branch: trimmed, remote: remoteMatch.remote };
  }

  // Fall back to a local ref; downstream produces a clear branch-not-found error.
  return { type: 'local', branch: trimmed };
}

type WorktreeServiceLike = LocalWorktreeContext['worktreeService'];

function describeWorktreeError(error: unknown): string {
  if (error && typeof error === 'object' && 'type' in error) {
    return String((error as { type: unknown }).type);
  }
  return String(error);
}

/**
 * Creates (or reuses) the git worktree for a branch and returns its absolute
 * path. Pure git work — performs NO database writes, so the caller can persist
 * rows only after this succeeds (atomic create).
 */
async function materializeWorktree(
  worktreeService: WorktreeServiceLike,
  args: { taskBranch: string | null; sourceBranch: Branch | undefined; repoPath: string }
): Promise<string> {
  if (!args.taskBranch) {
    return args.repoPath;
  }
  if (!args.sourceBranch || args.taskBranch === args.sourceBranch.branch) {
    const result = await worktreeService.checkoutExistingBranch(args.taskBranch);
    if (!result.success) {
      throw new Error(
        `Failed to check out branch "${args.taskBranch}": ${describeWorktreeError(result.error)}`
      );
    }
    return result.data;
  }
  const result = await worktreeService.checkoutBranchWorktree(args.sourceBranch, args.taskBranch);
  if (!result.success) {
    throw new Error(
      `Failed to create worktree for "${args.taskBranch}": ${describeWorktreeError(result.error)}`
    );
  }
  return result.data;
}

/**
 * Creates a workspace (and its parent task) for a local project, reusing the
 * in-app worktree + key-hash path.
 *
 * Atomic: the git worktree is created first; database rows are written only
 * after the worktree succeeds, so a git failure never leaves orphaned rows.
 *
 * Idempotent: if a non-archived task already owns the branch, the existing
 * workspace's worktree is ensured and returned instead of duplicating.
 */
export async function createWorkspace(
  db: AppDb,
  opts: CreateWorkspaceOptions
): Promise<CreateWorkspaceResult> {
  const strategy: WorkspaceStrategy = opts.strategy ?? 'new-branch';
  const base = (opts.base ?? opts.project.baseRef ?? 'main').trim();

  if (strategy !== 'no-worktree' && !opts.branch) {
    throw new Error('--branch is required (omit only with --no-worktree).');
  }

  const taskBranch = strategy === 'no-worktree' ? null : opts.branch!.trim();
  const name = (opts.name ?? taskBranch ?? 'workspace').trim();

  const worktreeDirectory = opts.worktreeDirectory ?? (await opts.settings?.getWorktreeDirectory());
  if (!worktreeDirectory) {
    throw new Error('Could not resolve a worktree directory for this project.');
  }

  const { worktreeService, repoGit } = await buildLocalWorktreeContext({
    projectName: opts.project.name,
    projectId: opts.project.id,
    repoPath: opts.project.path,
    baseRef: opts.project.baseRef,
    worktreeDirectory,
    settings: opts.settings,
  });

  // Resolve the source branch up front — handles both local (`main`) and remote
  // (`origin/main`) bases. checkout-existing forks from the branch itself.
  const sourceBranch: Branch | undefined =
    taskBranch === null
      ? { type: 'local', branch: base }
      : strategy === 'checkout-existing'
        ? { type: 'local', branch: taskBranch }
        : await resolveBaseBranch(repoGit, base);

  // Idempotency: an existing, non-archived task on the same branch already owns
  // a workspace — ensure its worktree exists and return it unchanged.
  if (taskBranch) {
    const [existingTask] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, opts.project.id),
          eq(tasks.taskBranch, taskBranch),
          isNull(tasks.archivedAt)
        )
      )
      .orderBy(desc(tasks.createdAt))
      .limit(1);

    if (existingTask?.workspaceId) {
      const [ws] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, existingTask.workspaceId));
      if (ws) {
        const wpath = await materializeWorktree(worktreeService, {
          taskBranch,
          sourceBranch: fromStoredBranch(existingTask.sourceBranch) ?? sourceBranch,
          repoPath: opts.project.path,
        });
        const key = computeWorkspaceKey('local', wpath);
        await db
          .update(workspaces)
          .set({ path: wpath, key, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(workspaces.id, ws.id));
        return {
          workspaceId: ws.id,
          taskId: existingTask.id,
          branch: taskBranch,
          path: wpath,
          key,
          type: 'local',
          reused: true,
        };
      }
    }
  }

  // --- Git first (atomic): nothing is written to the DB until this succeeds.
  const workspacePath = await materializeWorktree(worktreeService, {
    taskBranch,
    sourceBranch,
    repoPath: opts.project.path,
  });

  const key = computeWorkspaceKey('local', workspacePath);

  // persistPath dedupe: if a workspace already owns this path, reuse it.
  const [existingWs] = await db.select().from(workspaces).where(eq(workspaces.key, key));
  let workspaceId: string;
  let reused: boolean;
  if (existingWs) {
    workspaceId = existingWs.id;
    reused = true;
    await db
      .update(workspaces)
      .set({ path: workspacePath, key, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workspaces.id, workspaceId));
  } else {
    workspaceId = crypto.randomUUID();
    reused = false;
    await db
      .insert(workspaces)
      .values({ id: workspaceId, type: 'local', path: workspacePath, key });
  }

  const taskId = crypto.randomUUID();
  try {
    await db.insert(tasks).values({
      id: taskId,
      projectId: opts.project.id,
      name,
      taskBranch,
      status: 'in_progress',
      sourceBranch: toStoredBranch(sourceBranch),
      workspaceProvider: null,
      workspaceId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
    });
  } catch (error) {
    // Roll back the freshly-created workspace row so a task-insert failure
    // doesn't leave an orphan.
    if (!reused) {
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => {});
    }
    throw error;
  }

  // Optionally publish the new branch.
  let pushed: boolean | undefined;
  if (opts.pushBranch && taskBranch) {
    const pushRemote = (await opts.settings?.getPushRemote().catch(() => undefined)) ?? 'origin';
    const result = await repoGit.publishBranch(taskBranch, pushRemote);
    pushed = result.success;
  }

  // Optionally launch the agent and seed it with the initial prompt (one-shot
  // dispatch: create → open → send collapsed into one call).
  let agent: string | undefined;
  let conversationId: string | undefined;
  let promptDelivered: boolean | undefined;
  let warning: string | undefined;
  if (opts.prompt) {
    const providerId = (opts.agent ?? 'claude') as AgentProviderId;
    if (!getProvider(providerId)) {
      throw new Error(`Unknown agent provider: ${providerId}`);
    }
    if (!opts.dispatch) {
      throw new Error('Agent dispatch is unavailable (no dispatcher wired).');
    }
    // The app only adopts a tmux-backed agent session when the project has tmux
    // mode on; otherwise opening the task spawns a second (non-tmux) agent.
    const tmuxOn = (await opts.settings?.get().catch(() => undefined))?.tmux ?? false;
    if (!tmuxOn) {
      warning =
        'tmux mode is off for this project — the desktop app will spawn its own agent ' +
        'when this task is opened instead of adopting the CLI-launched one. Enable tmux ' +
        'mode (project setting) for one-shot dispatch to be adopted by the app.';
    }
    agent = providerId;
    conversationId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: conversationId,
      projectId: opts.project.id,
      taskId,
      title: getProvider(providerId)?.name ?? providerId,
      provider: providerId,
      config: opts.autoApprove ? serializeConversationConfig({ autoApprove: true }) : null,
      isInitialConversation: true,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      // Match the app: ISO string (not CURRENT_TIMESTAMP) so text-sorted
      // `desc(lastInteractedAt)` orders CLI- and app-created conversations correctly.
      lastInteractedAt: new Date().toISOString(),
    });
    const dispatched = await opts.dispatch({
      projectId: opts.project.id,
      taskId,
      conversationId,
      providerId,
      autoApprove: opts.autoApprove ?? false,
      prompt: opts.prompt,
      cwd: workspacePath,
    });
    promptDelivered = dispatched.delivered && dispatched.promptDelivered;
  }

  return {
    workspaceId,
    taskId,
    branch: taskBranch,
    path: workspacePath,
    key,
    type: 'local',
    reused,
    agent,
    conversationId,
    promptDelivered,
    pushed,
    warning,
  };
}

function runPreRemoveHook(
  cmd: string,
  cwd: string,
  env: Record<string, string>
): { ok: boolean; code: number | null } {
  const result = spawnSync('sh', ['-c', cmd], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Pre-remove hook failed to start: ${result.error.message}`);
  }
  return { ok: result.status === 0, code: result.status };
}

/**
 * Tears down a workspace: runs an optional capture hook, then removes the git
 * worktree, deletes the branch, and deletes the workspace + its task rows.
 *
 * Idempotent (re-running after a partial/complete removal succeeds) and
 * hook-safe: if the pre-remove hook fails, nothing is deleted unless `force`.
 */
export async function removeWorkspace(
  db: AppDb,
  opts: RemoveWorkspaceOptions
): Promise<RemoveWorkspaceResult> {
  if (!opts.branch && !opts.id) {
    throw new Error('Pass --branch <b> or --id <workspaceId> to remove.');
  }

  // Resolve the target workspace + the tasks pointing at it.
  let workspaceId: string | undefined = opts.id;
  let branch: string | null = opts.branch ?? null;

  if (!workspaceId && opts.branch) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, opts.project.id), eq(tasks.taskBranch, opts.branch)))
      .orderBy(desc(tasks.createdAt))
      .limit(1);
    workspaceId = task?.workspaceId ?? undefined;
  }

  const emptyResult: RemoveWorkspaceResult = {
    workspaceId: workspaceId ?? null,
    branch,
    hookRan: false,
    removedWorktree: false,
    removedBranch: false,
    deletedTasks: 0,
    deletedWorkspace: false,
    alreadyGone: true,
  };

  if (!workspaceId) {
    // Nothing matched — treat as already-removed (idempotent).
    return emptyResult;
  }

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const allLinkedTasks = await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId));

  // Safety: never act on a workspace that belongs to a different project (e.g.
  // `--project A --id <belongs-to-B>`). Only operate on this project's tasks.
  const linkedTasks = allLinkedTasks.filter((t) => t.projectId === opts.project.id);
  if (allLinkedTasks.length > 0 && linkedTasks.length === 0) {
    return emptyResult; // workspace is owned by another project
  }

  if (!ws && linkedTasks.length === 0) {
    return emptyResult;
  }

  if (!branch) {
    branch = linkedTasks.find((t) => t.taskBranch)?.taskBranch ?? null;
  }

  const worktreeDirectory = opts.worktreeDirectory ?? (await opts.settings?.getWorktreeDirectory());
  const worktreePath = ws?.path ?? null;

  const { worktreeService, repoGit, poolPath } = await buildLocalWorktreeContext({
    projectName: opts.project.name,
    projectId: opts.project.id,
    repoPath: opts.project.path,
    baseRef: opts.project.baseRef,
    worktreeDirectory: worktreeDirectory ?? opts.project.path,
    settings: opts.settings,
  });

  const pathExists = worktreePath ? fs.existsSync(worktreePath) : false;

  // --- Pre-remove hook (capture-before-delete). Abort on failure unless forced.
  let hookRan = false;
  if (opts.preRemoveCmd && !opts.skipHook) {
    const cwd = pathExists ? worktreePath! : opts.project.path;
    const { ok, code } = runPreRemoveHook(opts.preRemoveCmd, cwd, {
      EMDASH_WORKSPACE_ID: workspaceId,
      EMDASH_WORKSPACE_PATH: worktreePath ?? '',
      EMDASH_BRANCH: branch ?? '',
      EMDASH_PROJECT: opts.project.name,
    });
    hookRan = true;
    if (!ok && !opts.force) {
      throw new Error(
        `Pre-remove hook exited with code ${code}; aborting (nothing deleted). ` +
          `Use --force to remove anyway or --skip-hook to bypass.`
      );
    }
  }

  // --- Kill any live agent tmux sessions for this workspace BEFORE removing the
  // worktree, so we don't delete the cwd out from under a running agent or leave
  // an orphaned session (mirrors the app's teardownTask killing the session).
  const convs = linkedTasks.length
    ? await db
        .select()
        .from(conversations)
        .where(
          inArray(
            conversations.taskId,
            linkedTasks.map((t) => t.id)
          )
        )
    : [];
  for (const conv of convs) {
    const sessionName = makeTmuxSessionName(
      makePtySessionId(opts.project.id, conv.taskId, conv.id)
    );
    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
  }

  // --- Teardown (best-effort + idempotent).
  // Guard: only remove a worktree that lives inside this project's worktree pool
  // (never rm an arbitrary path a stale/mistargeted row might hold, nor the repo root).
  const insidePool =
    !!worktreePath &&
    worktreePath !== opts.project.path &&
    (worktreePath === poolPath || worktreePath.startsWith(poolPath + path.sep));
  let removedWorktree = false;
  if (pathExists && insidePool) {
    await worktreeService.removeWorktree(worktreePath!);
    removedWorktree = true;
  }

  // Don't delete the project's own base branch.
  const baseLocalName = opts.project.baseRef.includes('/')
    ? opts.project.baseRef.slice(opts.project.baseRef.indexOf('/') + 1)
    : opts.project.baseRef;
  let removedBranch = false;
  let branchRetained: 'unmerged' | undefined;
  if (branch && branch !== baseLocalName) {
    // Safe delete by default (-d, fails on unmerged commits → keeps the branch
    // so work is never silently lost). --force uses -D to delete regardless.
    const result = await repoGit.deleteBranch(branch, opts.force ?? false);
    removedBranch = result.success;
    if (!result.success && result.error.type === 'unmerged') {
      branchRetained = 'unmerged';
    }
  }

  let deletedTasks = 0;
  for (const task of linkedTasks) {
    await db.delete(tasks).where(eq(tasks.id, task.id));
    deletedTasks++;
  }

  let deletedWorkspace = false;
  if (ws) {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    deletedWorkspace = true;
  }

  return {
    workspaceId,
    branch,
    hookRan,
    removedWorktree,
    removedBranch,
    branchRetained,
    deletedTasks,
    deletedWorkspace,
    alreadyGone: false,
  };
}

export type SendWorkspaceOptions = {
  project: ResolvedProject;
  /** Target by branch … */
  branch?: string;
  /** … or by workspace id. */
  id?: string;
  /** Target a specific conversation; defaults to the task's primary agent session. */
  conversationId?: string;
  message: string;
};

export type SendWorkspaceResult = {
  delivered: boolean;
  reason?: 'no-task' | 'no-conversation' | 'no-active-session' | 'send-failed';
  taskId: string | null;
  conversationId: string | null;
  /** The tmux session targeted (derived identically to the app). */
  tmuxSession: string | null;
};

/** Indirection over `tmux` so the dispatch logic is unit-testable without tmux. */
export type TmuxRunner = {
  hasSession(name: string): boolean;
  sendKeys(name: string, keys: string[]): boolean;
};

const defaultTmuxRunner: TmuxRunner = {
  hasSession(name) {
    return spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }).status === 0;
  },
  sendKeys(name, keys) {
    return spawnSync('tmux', ['send-keys', '-t', name, ...keys], { stdio: 'ignore' }).status === 0;
  },
};

/**
 * Dispatches a message to a worktree's live agent by writing into the tmux
 * session emdash runs the agent in (requires tmux mode enabled for the
 * project). One-way / fire-and-forget.
 *
 * The text and the submit key are sent as TWO separate `send-keys` calls: a
 * trailing newline in the same call lands the text but doesn't submit a TUI
 * agent like Claude — a bare Enter as its own key event does.
 *
 * Never silently drops: returns `delivered:false` with a clear `reason`
 * (`no-active-session` when the agent isn't running in tmux).
 */
export async function sendToWorkspace(
  db: AppDb,
  opts: SendWorkspaceOptions,
  tmux: TmuxRunner = defaultTmuxRunner
): Promise<SendWorkspaceResult> {
  if (!opts.message) throw new Error('--message <text> is required.');
  if (!opts.branch && !opts.id) {
    throw new Error('Pass --branch <b> or --id <workspaceId> to send.');
  }

  const taskWhere = opts.branch
    ? and(eq(tasks.projectId, opts.project.id), eq(tasks.taskBranch, opts.branch))
    : and(eq(tasks.projectId, opts.project.id), eq(tasks.workspaceId, opts.id!));
  const [task] = await db
    .select()
    .from(tasks)
    .where(taskWhere)
    .orderBy(desc(tasks.lastInteractedAt))
    .limit(1);

  const base = { taskId: task?.id ?? null, conversationId: null, tmuxSession: null } as const;
  if (!task) {
    return { delivered: false, reason: 'no-task', ...base };
  }

  let conversationId: string | undefined;
  let tmuxSession: string | undefined;
  let activeSession = false;

  if (opts.conversationId) {
    conversationId = opts.conversationId;
    tmuxSession = makeTmuxSessionName(makePtySessionId(opts.project.id, task.id, conversationId));
    activeSession = tmux.hasSession(tmuxSession);
  } else {
    const convs = await db
      .select()
      .from(conversations)
      .where(eq(conversations.taskId, task.id))
      .orderBy(desc(conversations.isInitialConversation), desc(conversations.lastInteractedAt));
    if (convs.length === 0) {
      return {
        delivered: false,
        reason: 'no-conversation',
        taskId: task.id,
        conversationId: null,
        tmuxSession: null,
      };
    }

    for (const conv of convs) {
      const candidateSession = makeTmuxSessionName(
        makePtySessionId(opts.project.id, task.id, conv.id)
      );
      if (tmux.hasSession(candidateSession)) {
        conversationId = conv.id;
        tmuxSession = candidateSession;
        activeSession = true;
        break;
      }
    }

    if (!conversationId || !tmuxSession) {
      const preferred = convs[0]!;
      conversationId = preferred.id;
      tmuxSession = makeTmuxSessionName(makePtySessionId(opts.project.id, task.id, preferred.id));
    }
  }

  if (!conversationId || !tmuxSession) {
    return {
      delivered: false,
      reason: 'no-conversation',
      taskId: task.id,
      conversationId: null,
      tmuxSession: null,
    };
  }

  if (!activeSession) {
    return {
      delivered: false,
      reason: 'no-active-session',
      taskId: task.id,
      conversationId,
      tmuxSession,
    };
  }

  // `-l` = literal text; `--` ends option parsing so a message starting with
  // '-' isn't misread as a send-keys flag. Enter is sent as its own key event.
  const sentText = tmux.sendKeys(tmuxSession, ['-l', '--', opts.message]);
  const sentEnter = sentText && tmux.sendKeys(tmuxSession, ['Enter']);
  if (!sentText || !sentEnter) {
    return {
      delivered: false,
      reason: 'send-failed',
      taskId: task.id,
      conversationId,
      tmuxSession,
    };
  }

  return { delivered: true, taskId: task.id, conversationId, tmuxSession };
}

/** Best-effort project name derived from a worktree path (…/worktrees/<project>/<branch>). */
function deriveProjectFromPath(p: string | null): string | null {
  if (!p) return null;
  const parts = p.split(path.sep).filter(Boolean);
  const idx = parts.lastIndexOf('worktrees');
  if (idx !== -1 && idx + 1 < parts.length) return parts[idx + 1]!;
  return null;
}

/**
 * Lists workspaces from the workspaces table, enriched (via a tasks/projects
 * join) with the owning project name, branch and archived state. Defaults to
 * non-archived only.
 */
export async function listWorkspaces(
  db: AppDb,
  opts: ListWorkspacesOptions = {}
): Promise<WorkspaceListItem[]> {
  const rows = await db
    .select({
      ws: workspaces,
      taskId: tasks.id,
      taskBranch: tasks.taskBranch,
      archivedAt: tasks.archivedAt,
      projectName: projects.name,
    })
    .from(workspaces)
    .leftJoin(tasks, eq(tasks.workspaceId, workspaces.id))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .orderBy(desc(workspaces.createdAt));

  // Collapse one-or-more task rows per workspace into a single item. Prefer a
  // non-archived task for the displayed branch/project.
  const byId = new Map<string, WorkspaceListItem>();
  for (const row of rows) {
    const hasTask = row.taskId !== null;
    const taskArchived = hasTask && row.archivedAt !== null;
    const existing = byId.get(row.ws.id);

    if (!existing) {
      byId.set(row.ws.id, {
        id: row.ws.id,
        type: row.ws.type,
        branch: row.taskBranch ?? null,
        project: row.projectName ?? deriveProjectFromPath(row.ws.path),
        path: row.ws.path,
        linesAdded: row.ws.linesAdded,
        linesDeleted: row.ws.linesDeleted,
        // A workspace with tasks is archived only when ALL its tasks are.
        archived: hasTask ? taskArchived : false,
        createdAt: row.ws.createdAt,
      });
      continue;
    }

    // Merge additional task rows: an active task wins for display + archived.
    if (hasTask && !taskArchived) {
      existing.archived = false;
      existing.branch = row.taskBranch ?? existing.branch;
      existing.project = row.projectName ?? existing.project;
    } else if (hasTask && existing.archived) {
      existing.branch = existing.branch ?? row.taskBranch ?? null;
    }
  }

  let items = Array.from(byId.values());

  if (!opts.includeArchived) {
    items = items.filter((item) => !item.archived);
  }

  if (opts.project) {
    const needle = opts.project.toLowerCase();
    items = items.filter((item) => (item.project ?? '').toLowerCase() === needle);
  }

  return items;
}
