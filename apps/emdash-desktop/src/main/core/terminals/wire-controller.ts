import type { TerminalKey } from '@emdash/core/runtimes/terminals/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Contract, ContractImpl } from '@emdash/wire';
import { and, eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { appSettingsService } from '@main/core/settings/settings-service';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import {
  getLocalTerminalShellAvailability,
  resolveTerminalShellWithSystemFallback,
} from '@main/core/terminal-shell/resolver';
import { getTerminalsRuntimeClient } from '@main/core/wire-workers/accessors';
import { hostFileRefFromNativePath } from '@main/core/workspaces/runtime/workspace-runtime-host';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { db } from '@main/db/client';
import { tasks, terminals } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import type { TerminalShellId } from '@shared/core/terminals/terminal-settings';
import type { Terminal } from '@shared/core/terminals/terminals';
import type {
  terminalTabsWireContract,
  TerminalCreateResult,
  TerminalHydrateResult,
} from '@shared/core/terminals/wire-contract';

type TerminalTabsDefinitions = typeof terminalTabsWireContract extends Contract<infer Defs>
  ? Defs
  : never;
type TerminalTabsWireImpl = ContractImpl<TerminalTabsDefinitions>;
type TerminalError = {
  type: string;
  message: string;
  nodeId?: string;
  resolutions?: string[];
};

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };

export function createTerminalTabsWireController(): {
  impl: TerminalTabsWireImpl;
  dispose(): Promise<void>;
} {
  return {
    impl: {
      list: (input) => listTerminals(input),
      create: (input) => createTerminal(input),
      delete: (input) => deleteTerminal(input),
      rename: (input) => renameTerminal(input),
      hydrate: (input) => hydrateTerminal(input),
      getShellAvailability: () => getShellAvailability(),
    },
    async dispose() {},
  };
}

async function listTerminals({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}): Promise<Result<Terminal[], TerminalError>> {
  const rows = await db
    .select()
    .from(terminals)
    .where(and(eq(terminals.projectId, projectId), eq(terminals.taskId, taskId)));
  return ok(rows.map(mapTerminalRowToTerminal));
}

async function createTerminal(input: {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  shell?: TerminalShellId;
  initialSize?: { cols: number; rows: number };
}): Promise<Result<TerminalCreateResult, TerminalError>> {
  const shell = input.shell ?? (await appSettingsService.get('terminal')).defaultShell;
  const [row] = await db
    .insert(terminals)
    .values({
      id: input.id,
      projectId: input.projectId,
      taskId: input.taskId,
      name: input.name,
      shellId: shell,
      ssh: 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const terminal = mapTerminalRowToTerminal(row);
  const hydrated = await startRuntimeTerminal(terminal, input.initialSize);
  if (!hydrated.success) {
    await db.delete(terminals).where(eq(terminals.id, input.id)).execute();
    return hydrated;
  }

  telemetryService.capture('terminal_created', {
    terminal_id: input.id,
    project_id: input.projectId,
    task_id: input.taskId,
  });

  return ok({ terminal, key: hydrated.data.key });
}

async function deleteTerminal({
  projectId,
  taskId,
  terminalId,
}: {
  projectId: string;
  taskId: string;
  terminalId: string;
}): Promise<Result<void, TerminalError>> {
  await db
    .delete(terminals)
    .where(
      and(
        eq(terminals.id, terminalId),
        eq(terminals.projectId, projectId),
        eq(terminals.taskId, taskId)
      )
    );

  const key = await runtimeKeyFor(projectId, taskId, terminalId);
  if (key.success) {
    const terminalsRuntime = await getTerminalsRuntimeClient();
    await terminalsRuntime.kill({ key: key.data });
  }

  telemetryService.capture('terminal_deleted', {
    terminal_id: terminalId,
    project_id: projectId,
    task_id: taskId,
  });
  return ok(undefined);
}

async function renameTerminal(
  input: { terminalId: string; name: string }
): Promise<Result<void, TerminalError>> {
  await db
    .update(terminals)
    .set({ name: input.name, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(terminals.id, input.terminalId));
  return ok(undefined);
}

async function hydrateTerminal(input: {
  projectId: string;
  taskId: string;
  terminalId: string;
  initialSize?: { cols: number; rows: number };
}): Promise<Result<TerminalHydrateResult, TerminalError>> {
  const [row] = await db
    .select()
    .from(terminals)
    .where(
      and(
        eq(terminals.id, input.terminalId),
        eq(terminals.projectId, input.projectId),
        eq(terminals.taskId, input.taskId)
      )
    )
    .limit(1);
  if (!row) return err(terminalError('missing-terminal', `Terminal ${input.terminalId} not found`));
  return startRuntimeTerminal(mapTerminalRowToTerminal(row), input.initialSize);
}

async function getShellAvailability() {
  try {
    return ok(await getLocalTerminalShellAvailability());
  } catch (error) {
    return err(terminalError('shell-availability-failed', errorMessage(error)));
  }
}

async function startRuntimeTerminal(
  terminal: Terminal,
  initialSize: { cols: number; rows: number } = DEFAULT_TERMINAL_SIZE
): Promise<Result<TerminalHydrateResult, TerminalError>> {
  const context = await resolveTerminalContext(terminal.projectId, terminal.taskId, terminal.id);
  if (!context.success) return context;

  const profile = await resolveTerminalShellWithSystemFallback({
    intent: terminal.shellId,
    target: { kind: 'local' },
    onFallback: (error) =>
      log.warn('terminal-tabs: falling back to system shell', {
        terminalId: terminal.id,
        shell: error.shell,
        message: error.message,
      }),
  });
  const terminalsRuntime = await getTerminalsRuntimeClient();
  const colorEnv = await getTerminalColorEnv();
  const startResult = await terminalsRuntime.startTerminal({
    key: context.data.key,
    spec: {
      cwd: context.data.workspace.path,
      shellProfile: profile,
      shellSetup: context.data.shellSetup,
      tmux: context.data.tmuxEnabled,
      env: {
        ...profile.capturedEnv,
        ...context.data.taskEnvVars,
        ...colorEnv,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    },
  });
  if (!startResult.success) return startResult;
  return ok({ key: context.data.key });
}

async function resolveTerminalContext(projectId: string, taskId: string, terminalId: string) {
  const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!taskRow) return err(terminalError('missing-task', `Task ${taskId} not found`));

  const project = projectManager.getProject(projectId);
  if (!project) return err(terminalError('missing-project', `Project ${projectId} not found`));

  const workspaceId = workspaceIdForTask(taskId);
  if (!workspaceId) {
    return err(terminalError('missing-workspace', `Task ${taskId} has no mounted workspace`));
  }
  const workspace = workspaceRegistry.get(workspaceId);
  if (!workspace) {
    return err(terminalError('missing-workspace', `Workspace ${workspaceId} is not mounted`));
  }

  const projectSettings = await workspace.settings.get();
  const defaultBranch = await workspace.settings.getDefaultBranch();
  const taskLevelSettings = await getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFiles: workspace.files,
    taskConfigPath: workspace.configPath,
  });

  return ok({
    workspace,
    key: runtimeKey(workspace.path, projectId, taskId, terminalId),
    tmuxEnabled: projectSettings.tmux ?? false,
    shellSetup: taskLevelSettings.shellSetup ?? projectSettings.shellSetup,
    taskEnvVars: getTaskEnvVars({
      taskId,
      taskName: taskRow.name,
      taskPath: workspace.path,
      projectPath: project.repoPath,
      defaultBranch,
      portSeed: workspace.path,
    }),
  });
}

function workspaceIdForTask(taskId: string): string | undefined {
  return taskSessionManager.getWorkspaceId(taskId);
}

async function runtimeKeyFor(
  projectId: string,
  taskId: string,
  terminalId: string
): Promise<Result<TerminalKey, TerminalError>> {
  const context = await resolveTerminalContext(projectId, taskId, terminalId);
  if (!context.success) return context;
  return ok(context.data.key);
}

function runtimeKey(
  workspacePath: string,
  projectId: string,
  taskId: string,
  terminalId: string
): TerminalKey {
  return {
    workspace: hostFileRefFromNativePath(workspacePath),
    id: makePtySessionId(projectId, taskId, terminalId),
  };
}

function mapTerminalRowToTerminal(row: typeof terminals.$inferSelect): Terminal {
  return {
    id: row.id,
    taskId: row.taskId,
    ssh: row.ssh === 1,
    projectId: row.projectId,
    shellId: row.shellId,
    name: row.name,
  };
}

function terminalError(type: string, message: string): TerminalError {
  return { type, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
