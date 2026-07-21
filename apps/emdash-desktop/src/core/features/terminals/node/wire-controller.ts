import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobFailedError,
  type LeasedLiveModelProvider,
  type LiveJobContext,
  type LiveSource,
} from '@emdash/wire';
import { createController, type CallMeta, type Controller } from '@emdash/wire/api';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  terminalsContract,
  type RunTerminalScriptWorkflowInput,
  type TerminalCreateResult,
  type TerminalHydrateResult,
  type TerminalRuntimeKey,
} from '@core/features/terminals/api';
import {
  isTerminalsRuntimeResolveError,
  throwTerminalsRuntimeResolveError,
  type TerminalsHostRuntimesClient as HostRuntimesClient,
  type TerminalsRunScriptWorkflowInput as RunScriptWorkflowInput,
  type TerminalsRuntimeError as TerminalError,
  type TerminalsRuntimeBroker,
  type TerminalsRuntimeKey as TerminalKey,
  type TerminalsRuntimeResolveError as RuntimeResolveError,
  type TerminalsScriptWorkflowProgress as ScriptWorkflowProgress,
  type TerminalsScriptWorkflowResult as ScriptWorkflowResult,
  type TerminalsWorkspaceIdentity as WorkspaceIdentity,
  type TerminalsWorkspaceIdentityResolver,
} from '@core/features/terminals/api/runtime-adapter';
import { terminalsRuntimeContract } from '@core/features/terminals/api/runtime-adapter';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { makePtySessionId } from '@core/primitives/pty/api';
import { type Terminal, type TerminalShellId } from '@core/primitives/terminals/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks, terminals } from '@core/services/app-db/node/schema';
import type { AppSettingsService } from '@core/services/settings/node';
import { filesClientScope } from '@main/core/files/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import {
  getLocalTerminalShellAvailability,
  resolveTerminalShellWithSystemFallback,
} from '@main/core/terminal-shell/resolver';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

type CreateTerminalsWireControllerOptions = Readonly<{
  db: AppDb;
  runtimes: TerminalsRuntimeBroker;
  settings: Pick<AppSettingsService, 'get'>;
  workspaceIdentity: TerminalsWorkspaceIdentityResolver;
}>;

type TerminalContext = Readonly<{
  identity: WorkspaceIdentity;
  workspace: HostFileRef;
  key: TerminalKey;
  tmuxEnabled: boolean;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
}>;
type TerminalControllerError = TerminalError | RuntimeResolveError;

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };

export function createTerminalsWireController(
  options: CreateTerminalsWireControllerOptions
): Controller {
  return createController(terminalsContract, {
    list: (input) => listTerminals(options, input),
    create: (input) => createTerminal(options, input),
    delete: (input) => deleteTerminal(options, input),
    rename: (input) => renameTerminal(options, input),
    hydrate: (input) => hydrateTerminal(options, input),
    getShellAvailability: () => getShellAvailability(),
    runScriptWorkflow: {
      run: (input, context) => runScriptWorkflow(options, input, context),
      toError: unknownToTerminalError,
    },
    workflows: createWorkflowsProvider(options),
    output: (key) =>
      leasedLiveSource(() =>
        acquireRuntimeSource(options, key.workspaceId, (client, identity) =>
          client.terminals.output.handle(toTerminalKey(identity, key.terminalId)).asLiveSource()
        )
      ),
    sendInput: (input, meta) =>
      withTerminalRuntime(options, input, (client, key) =>
        client.sendInput({ key, data: input.data }, callOptions(meta))
      ),
    resize: (input, meta) =>
      withTerminalRuntime(options, input, (client, key) =>
        client.resize({ key, cols: input.cols, rows: input.rows }, callOptions(meta))
      ),
    kill: (input, meta) =>
      withTerminalRuntime(options, input, (client, key) => client.kill({ key }, callOptions(meta))),
    killScope: (input, meta) =>
      withWorkspaceRuntime(options, input.workspaceId, (client, identity) =>
        client.terminals.killScope({ workspace: workspaceRef(identity) }, callOptions(meta))
      ),
    detachScope: (input, meta) =>
      withWorkspaceRuntime(options, input.workspaceId, (client, identity) =>
        client.terminals.detachScope({ workspace: workspaceRef(identity) }, callOptions(meta))
      ),
  });
}

async function listTerminals(
  options: CreateTerminalsWireControllerOptions,
  {
    projectId,
    taskId,
  }: {
    projectId: string;
    taskId: string;
  }
): Promise<Result<Terminal[], TerminalControllerError>> {
  const rows = await options.db
    .select()
    .from(terminals)
    .where(and(eq(terminals.projectId, projectId), eq(terminals.taskId, taskId)));
  return ok(rows.map(mapTerminalRowToTerminal));
}

async function createTerminal(
  options: CreateTerminalsWireControllerOptions,
  input: {
    id: string;
    projectId: string;
    taskId: string;
    name: string;
    shell?: TerminalShellId;
    initialSize?: { cols: number; rows: number };
  }
): Promise<Result<TerminalCreateResult, TerminalControllerError>> {
  const shell = input.shell ?? (await options.settings.get('terminal')).defaultShell;
  const [row] = await options.db
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
  const hydrated = await startRuntimeTerminal(options, terminal, input.initialSize);
  if (!hydrated.success) {
    await options.db.delete(terminals).where(eq(terminals.id, input.id)).execute();
    return hydrated;
  }

  telemetryService.capture('terminal_created', {
    terminal_id: input.id,
    project_id: input.projectId,
    task_id: input.taskId,
  });
  return ok({ terminal, key: hydrated.data.key });
}

async function deleteTerminal(
  options: CreateTerminalsWireControllerOptions,
  {
    projectId,
    taskId,
    terminalId,
  }: {
    projectId: string;
    taskId: string;
    terminalId: string;
  }
): Promise<Result<void, TerminalControllerError>> {
  const workspaceId = await resolveWorkspaceIdForTask(options.db, projectId, taskId);
  await options.db
    .delete(terminals)
    .where(
      and(
        eq(terminals.id, terminalId),
        eq(terminals.projectId, projectId),
        eq(terminals.taskId, taskId)
      )
    );

  if (workspaceId) {
    await withTerminalRuntime(
      options,
      {
        workspaceId,
        terminalId: makePtySessionId(projectId, taskId, terminalId),
      },
      (client, key) => client.kill({ key })
    ).catch(() => {});
  }

  telemetryService.capture('terminal_deleted', {
    terminal_id: terminalId,
    project_id: projectId,
    task_id: taskId,
  });
  return ok(undefined);
}

async function renameTerminal(
  options: CreateTerminalsWireControllerOptions,
  input: {
    terminalId: string;
    name: string;
  }
): Promise<Result<void, TerminalControllerError>> {
  await options.db
    .update(terminals)
    .set({ name: input.name, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(terminals.id, input.terminalId));
  return ok(undefined);
}

async function hydrateTerminal(
  options: CreateTerminalsWireControllerOptions,
  input: {
    projectId: string;
    taskId: string;
    terminalId: string;
    initialSize?: { cols: number; rows: number };
  }
): Promise<Result<TerminalHydrateResult, TerminalControllerError>> {
  const [row] = await options.db
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
  return startRuntimeTerminal(options, mapTerminalRowToTerminal(row), input.initialSize);
}

async function getShellAvailability() {
  try {
    return ok(await getLocalTerminalShellAvailability());
  } catch (error) {
    return err(terminalError('shell-availability-failed', errorMessage(error)));
  }
}

async function startRuntimeTerminal(
  options: CreateTerminalsWireControllerOptions,
  terminal: Terminal,
  initialSize: { cols: number; rows: number } = DEFAULT_TERMINAL_SIZE
): Promise<Result<TerminalHydrateResult, TerminalControllerError>> {
  const context = await resolveTerminalContext(options, terminal);
  if (!context.success) return context;

  const profile = await resolveTerminalShellWithSystemFallback({
    intent: terminal.shellId,
    target: { kind: 'local' },
    onFallback: (error) =>
      log.warn('terminals: falling back to system shell', {
        terminalId: terminal.id,
        shell: error.shell,
        message: error.message,
      }),
  });
  const colorEnv = await getTerminalColorEnv();
  const result = await withWorkspaceRuntime(options, context.data.identity.workspaceId, (client) =>
    client.terminals.startTerminal({
      key: context.data.key,
      spec: {
        cwd: context.data.identity.path,
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
    })
  );
  if (!result.success) return result;
  return ok({
    key: {
      workspaceId: context.data.identity.workspaceId,
      terminalId: context.data.key.id,
    },
  });
}

async function resolveTerminalContext(
  options: CreateTerminalsWireControllerOptions,
  terminal: Terminal
): Promise<Result<TerminalContext, TerminalControllerError>> {
  const [taskRow] = await options.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, terminal.taskId),
        eq(tasks.projectId, terminal.projectId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);
  if (!taskRow) return err(terminalError('missing-task', `Task ${terminal.taskId} not found`));
  if (!taskRow.workspaceId) {
    return err(terminalError('missing-workspace', `Task ${terminal.taskId} has no workspace`));
  }

  const project = projectManager.getProject(terminal.projectId);
  if (!project) {
    return err(terminalError('missing-project', `Project ${terminal.projectId} not found`));
  }
  const identity = await options.workspaceIdentity.resolve(taskRow.workspaceId);
  if (!identity) {
    return err(
      terminalError('missing-workspace', `Workspace ${taskRow.workspaceId} was not found`)
    );
  }

  return withWorkspaceRuntime(options, identity.workspaceId, async (client) => {
    const taskFiles = filesClientScope(client.files, identity.path);
    const projectSettings = await project.settings.get();
    const defaultBranch = await project.settings.getDefaultBranch();
    const taskLevelSettings = await getEffectiveTaskSettings({
      projectSettings: project.settings,
      taskFiles,
      taskConfigPath: project.configPathForDirectory(identity.path),
    });
    return ok({
      identity,
      workspace: workspaceRef(identity),
      key: toTerminalKey(
        identity,
        makePtySessionId(terminal.projectId, terminal.taskId, terminal.id)
      ),
      tmuxEnabled: projectSettings.tmux ?? false,
      shellSetup: taskLevelSettings.shellSetup ?? projectSettings.shellSetup,
      taskEnvVars: getTaskEnvVars({
        taskId: terminal.taskId,
        taskName: taskRow.name,
        taskPath: identity.path,
        projectPath: project.repoPath,
        defaultBranch,
        portSeed: identity.path,
      }),
    });
  });
}

async function runScriptWorkflow(
  options: CreateTerminalsWireControllerOptions,
  input: RunTerminalScriptWorkflowInput,
  context: LiveJobContext<ScriptWorkflowProgress>
): Promise<Result<ScriptWorkflowResult, TerminalControllerError>> {
  const [taskRow] = await options.db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt))
    )
    .limit(1);
  if (!taskRow) return err(terminalError('missing-task', `Task ${input.taskId} not found`));
  if (taskRow.workspaceId !== input.workspaceId) {
    return err(terminalError('missing-workspace', `Task ${input.taskId} is not in this workspace`));
  }
  const project = projectManager.getProject(input.projectId);
  if (!project)
    return err(terminalError('missing-project', `Project ${input.projectId} not found`));

  return withWorkspaceRuntime(options, input.workspaceId, async (client, identity) => {
    const projectSettings = await project.settings.get();
    const taskSettings = await getEffectiveTaskSettings({
      projectSettings: project.settings,
      taskFiles: filesClientScope(client.files, identity.path),
      taskConfigPath: project.configPathForDirectory(identity.path),
    });
    const command = taskSettings.scripts?.[input.type];
    if (!command) {
      return ok({
        workflowId: context.jobId,
        kind: `manual:${input.type}`,
        completedNodes: [],
      });
    }
    const defaultBranch = await project.settings.getDefaultBranch();
    return runUpstreamWorkflow(
      client,
      {
        workspace: workspaceRef(identity),
        kind: `manual:${input.type}`,
        nodes: [
          {
            id: input.type,
            label: labelForScript(input.type),
            command,
            shellSetup: taskSettings.shellSetup ?? projectSettings.shellSetup,
            cwd: identity.path,
            env: getTaskEnvVars({
              taskId: input.taskId,
              taskName: taskRow.name,
              taskPath: identity.path,
              projectPath: project.repoPath,
              defaultBranch,
              portSeed: identity.path,
            }),
          },
        ],
      },
      context
    );
  });
}

function createWorkflowsProvider(
  options: CreateTerminalsWireControllerOptions
): LeasedLiveModelProvider<typeof terminalsContract.workflows> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: terminalsContract.workflows,
    acquireState: (key, name) =>
      acquireRuntimeSource(options, key.workspaceId, (client, identity) =>
        client.terminals.workflows.state({ workspace: workspaceRef(identity) }, name).asLiveSource()
      ),
    async runMutation() {
      throw new Error('Terminal workflows model has no mutations');
    },
    async dispose() {},
  };
}

async function runUpstreamWorkflow(
  client: HostRuntimesClient,
  input: RunScriptWorkflowInput,
  context: LiveJobContext<ScriptWorkflowProgress>
): Promise<Result<ScriptWorkflowResult, TerminalControllerError>> {
  const jobs = createLiveJobReplica(
    terminalsRuntimeContract.runWorkflow,
    client.terminals.runWorkflow
  );
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    const unsubscribe = job.onProgress(context.progress);
    const cancel = () => void job.cancel();
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) cancel();
    try {
      return ok(await job.result);
    } catch (error) {
      if (error instanceof LiveJobFailedError) return err(error.error);
      throw error;
    } finally {
      context.signal.removeEventListener('abort', cancel);
      unsubscribe();
    }
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}

async function withTerminalRuntime<T, E>(
  options: CreateTerminalsWireControllerOptions,
  input: TerminalRuntimeKey,
  work: (client: HostRuntimesClient['terminals'], key: TerminalKey) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  return withWorkspaceRuntime(options, input.workspaceId, (client, identity) =>
    work(client.terminals, toTerminalKey(identity, input.terminalId))
  );
}

async function withWorkspaceRuntime<T, E>(
  options: CreateTerminalsWireControllerOptions,
  workspaceId: string,
  work: (client: HostRuntimesClient, identity: WorkspaceIdentity) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const identity = await requireIdentity(options.workspaceIdentity.resolve(workspaceId));
  const lease = options.runtimes.session(identity.host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) return err(runtime.error);
    return await work(runtime.data, identity);
  } finally {
    await lease.release();
  }
}

function acquireRuntimeSource(
  options: CreateTerminalsWireControllerOptions,
  workspaceId: string,
  source: (client: HostRuntimesClient, identity: WorkspaceIdentity) => LiveSource
): PendingLease<LiveSource> {
  const acquired = (async () => {
    const identity = await requireIdentity(options.workspaceIdentity.resolve(workspaceId));
    const lease = options.runtimes.session(identity.host);
    return { identity, lease, ready: lease.ready() };
  })();
  return {
    async ready() {
      const { identity, ready } = await acquired;
      const runtime = await ready;
      if (!runtime.success) throwTerminalsRuntimeResolveError(runtime.error);
      return source(runtime.data, identity);
    },
    async release() {
      // If acquisition failed there is no lease to release; the failure already
      // surfaced through ready() and must not reject again here.
      const runtime = await acquired.catch(() => null);
      if (runtime) await runtime.lease.release();
    },
  };
}

function leasedLiveSource(acquire: () => PendingLease<LiveSource>): LiveSource {
  return {
    async snapshot() {
      const lease = acquire();
      try {
        return await (await lease.ready()).snapshot();
      } finally {
        await lease.release();
      }
    },
    async subscribe(callback, options) {
      const lease = acquire();
      try {
        const unsubscribe = await (await lease.ready()).subscribe(callback, options);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try {
            unsubscribe();
          } finally {
            void lease.release();
          }
        };
      } catch (error) {
        await lease.release();
        throw error;
      }
    },
  };
}

async function resolveWorkspaceIdForTask(
  db: AppDb,
  projectId: string,
  taskId: string
): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .limit(1);
  return row?.workspaceId ?? null;
}

async function requireIdentity(
  identityPromise: Promise<WorkspaceIdentity | null>
): Promise<WorkspaceIdentity> {
  const identity = await identityPromise;
  if (!identity) throw new Error('Terminal workspace identity was not found');
  return identity;
}

function workspaceRef(identity: WorkspaceIdentity): HostFileRef {
  return hostFileRefFromNativePath(identity.path, sshConnectionIdOf(identity.host));
}

function toTerminalKey(identity: WorkspaceIdentity, terminalId: string): TerminalKey {
  return {
    workspace: workspaceRef(identity),
    id: terminalId,
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

function unknownToTerminalError(error: unknown): TerminalControllerError {
  if (isTerminalsRuntimeResolveError(error)) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as TerminalError;
  }
  return terminalError('terminal-wire-error', errorMessage(error));
}

function labelForScript(type: RunTerminalScriptWorkflowInput['type']): string {
  return type[0]!.toUpperCase() + type.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}
