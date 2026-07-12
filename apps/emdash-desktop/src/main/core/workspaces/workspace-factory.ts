import { err, ok, type Result } from '@emdash/shared';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { FileTreeProjector } from '@main/core/files/file-tree/projector';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { invalidateLegacySshGitWorktreeStatus } from '@main/core/runtime/legacy/ssh-git';
import type { IFilesRuntime } from '@main/core/runtime/types';
import type { MachineRef, RuntimeManager } from '@main/core/runtime/types';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { resolveLocalAutomationShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import { runLifecycleScriptWithPolicy } from '@main/core/terminals/lifecycle-script-coordinator';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import {
  LifecycleScriptService,
  type LifecyclePreviewStartupError,
  type RequiredLifecycleStartup,
} from '@main/core/workspaces/workspace-lifecycle-service';
import type {
  WorkspaceAcquireControl,
  WorkspaceFactoryResult,
} from '@main/core/workspaces/workspace-registry';
import { handleGitWorktreeUpdate } from '@main/core/workspaces/workspace-worktree-update';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { fileChangesChannel, fileTreeProjectionChannel } from '@shared/core/fs/fsEvents';
import { gitWorktreeUpdateChannel } from '@shared/core/git/events';
import { previewServerUrl } from '@shared/core/preview-servers/types';
import type { Task } from '@shared/core/tasks/tasks';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import { TEARDOWN_SCRIPT_WAIT_MS } from '../tasks/provision-task-error';
import { getTaskEnvVars } from './workspace-env';

export type WorkspaceType =
  | { kind: 'local' }
  | { kind: 'ssh'; proxy: SshClientProxy; connectionId: string };

export type WorkspaceFactoryContext = {
  task: Pick<Task, 'id' | 'name'>;
  workDir: string;
  projectId: string;
  projectPath: string;
  workspaceRuntime: {
    machine: MachineRef;
    manager: Pick<RuntimeManager, 'acquire'>;
  };
  settings: ProjectSettingsProvider;
  logPrefix: string;
  /** Inject an existing repository service (e.g. the project-level singleton). */
  gitRepository?: GitRepositoryService;
  /** Inject an existing fetch service. When absent, the factory creates and manages one.
   *  Lifecycle (start/stop) is only managed by the factory when it creates the instance. */
  gitRepositoryFetchService?: GitRepositoryFetchService;
  extraHooks?: {
    onCreate?: (ws: Workspace) => Promise<void>;
    onDestroy?: (ws: Workspace) => Promise<void>;
    onDetach?: (ws: Workspace) => Promise<void>;
  };
  strictStartup?: {
    requirePreview: boolean;
    signal?: AbortSignal;
    deadlineAt?: number;
    previewTimeoutMs?: number;
    previewPollIntervalMs?: number;
    runStartupGraceMs?: number;
  };
};

/**
 * Returns a factory function suitable for passing to `WorkspaceRegistry.acquire`.
 * Handles all transport-specific construction (local vs SSH) and wires lifecycle
 * script hooks. Provider-specific hooks (e.g. git watcher) are passed via `extraHooks`.
 */
export function createWorkspaceFactory(
  workspaceId: string,
  type: WorkspaceType,
  context: WorkspaceFactoryContext
): (control?: WorkspaceAcquireControl) => Promise<WorkspaceFactoryResult> {
  return async (acquisitionControl) => {
    const workDir = context.workDir;
    const control: WorkspaceAcquireControl = acquisitionControl
      ? {
          signal: acquisitionControl.signal,
          deadlineAt: context.strictStartup?.deadlineAt ?? acquisitionControl.deadlineAt,
        }
      : {
          signal: context.strictStartup?.signal,
          deadlineAt: context.strictStartup?.deadlineAt,
        };
    throwIfWorkspaceFactoryStopped(control);

    const ctx =
      type.kind === 'ssh'
        ? new SshExecutionContext(type.proxy, { connectionId: type.connectionId })
        : new LocalExecutionContext();

    const runtime = await acquireWorkspaceRuntime(context.workspaceRuntime, workDir, control);
    let lifecycleService: LifecycleScriptService | undefined;
    let fileTreeProjector: FileTreeProjector | undefined;
    try {
      const { gitWorktree, fileTree, filesRuntime } = runtime;
      throwIfWorkspaceFactoryStopped(control);
      const openedFileSystem = filesRuntime.fileSystem();
      if (!openedFileSystem.success) {
        throw new Error(`Failed to open file system: ${openedFileSystem.error.message}`);
      }
      const fileSystem = openedFileSystem.data;
      const configPath = filesRuntime.path.join(workDir, '.emdash.json');

      // Settings (shared)
      const projectSettings = await awaitWithWorkspaceFactoryReadQuiescence(
        context.settings.get(),
        control
      );
      const defaultBranch = await awaitWithWorkspaceFactoryReadQuiescence(
        context.settings.getDefaultBranch(),
        control
      );
      const bootstrapTaskEnvVars = getTaskEnvVars({
        taskId: context.task.id,
        taskName: context.task.name,
        taskPath: workDir,
        projectPath: context.projectPath,
        defaultBranch,
        portSeed: workDir,
      });
      const tmuxEnabled = projectSettings.tmux ?? false;
      const taskLevelSettings = await awaitWithWorkspaceFactoryReadQuiescence(
        getEffectiveTaskSettings({
          projectSettings: context.settings,
          taskFs: fileSystem,
          taskConfigPath: configPath,
        }),
        control
      );
      const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
      const scripts = taskLevelSettings.scripts;

      // Transport-specific workspace terminal provider (used only by lifecycle scripts)
      const workspaceTerminals =
        type.kind === 'ssh'
          ? new SshTerminalProvider({
              projectId: context.projectId,
              workspaceId,
              scopeId: workspaceId,
              taskPath: workDir,
              tmux: tmuxEnabled,
              shellSetup,
              ctx,
              proxy: type.proxy,
              connectionId: type.connectionId,
              taskEnvVars: bootstrapTaskEnvVars,
            })
          : new LocalTerminalProvider({
              projectId: context.projectId,
              workspaceId,
              scopeId: workspaceId,
              taskPath: workDir,
              tmux: tmuxEnabled,
              shellSetup,
              ctx,
              taskEnvVars: bootstrapTaskEnvVars,
            });

      lifecycleService = new LifecycleScriptService({
        projectId: context.projectId,
        workspaceId,
        terminals: workspaceTerminals,
      });

      const gitRepository =
        context.gitRepository ?? new GitRepositoryService(gitWorktree.repository, context.settings);

      const ownsFetchService = !context.gitRepositoryFetchService;
      const gitRepositoryFetchService =
        context.gitRepositoryFetchService ??
        new GitRepositoryFetchService(gitRepository, () => gitRepository.getBaseRemote());
      let unsubscribeGitUpdates: (() => void) | undefined;
      let unsubscribeFileChanges: (() => void) | undefined;

      fileTreeProjector = new FileTreeProjector(fileTree, (update) =>
        events.emit(fileTreeProjectionChannel, {
          projectId: context.projectId,
          workspaceId,
          subscriptionId: update.subscriptionId,
          version: update.version,
          scopes: update.scopes,
        })
      );
      const disposeWorkspace = createRetryableWorkspaceFactoryCleanup([
        async () => {
          unsubscribeGitUpdates?.();
          unsubscribeGitUpdates = undefined;
        },
        async () => fileTreeProjector.dispose(),
        async () => {
          unsubscribeFileChanges?.();
          unsubscribeFileChanges = undefined;
        },
        () => runtime.release(),
      ]);

      const workspace: Workspace = {
        id: workspaceId,
        path: workDir,
        configPath,
        fileSystem,
        fileTree,
        fileTreeProjector,
        gitWorktree,
        settings: context.settings,
        lifecycleService,
        gitRepository,
        gitRepositoryFetchService,
        dispose: disposeWorkspace,
      };

      const { logPrefix } = context;
      throwIfWorkspaceFactoryStopped(control);

      return {
        workspace,
        sshFilesRuntime: type.kind === 'ssh' ? filesRuntime : undefined,

        onCreateSideEffect: (ws) => {
          void workspaceFileIndexService.onWorkspaceActivated(workspaceId, {
            rootPath: ws.path,
            enumerate: (root, options) => {
              const fs = filesRuntime.fileSystem();
              return fs.success ? fs.data.enumerate(root, options) : fs;
            },
          });
          unsubscribeGitUpdates = ws.gitWorktree.subscribe((update) =>
            handleGitWorktreeUpdate(workspaceId, update, (emitted) => {
              events.emit(gitWorktreeUpdateChannel, {
                projectId: context.projectId,
                workspaceId,
                update: emitted,
              });
            })
          );
          const fileChanges = filesRuntime.watchChanges(workDir, (update) => {
            if (type.kind === 'ssh') {
              invalidateLegacySshGitWorktreeStatus(ws.gitWorktree);
            }
            events.emit(fileChangesChannel, {
              projectId: context.projectId,
              workspaceId,
              update,
            });
            workspaceFileIndexService.onWorkspaceFileChange(workspaceId, update);
          });
          if (fileChanges.success) {
            unsubscribeFileChanges = fileChanges.data.unsubscribe;
            void fileChanges.data.ready().then((result) => {
              if (!result.success) {
                log.warn('WorkspaceFactory: file change feed failed to become ready', {
                  workspaceId,
                  error: result.error,
                });
              }
            });
          } else {
            log.warn('WorkspaceFactory: failed to start file change feed', {
              workspaceId,
              error: fileChanges.error,
            });
          }

          if (ownsFetchService) {
            gitRepositoryFetchService.start();
          }
          dispatchWorkspaceLifecycleStartup({
            strict: context.strictStartup !== undefined,
            lifecycleService,
            required: {
              setup: scripts?.setup
                ? { type: 'setup', script: scripts.setup, shellSetup }
                : undefined,
              run: scripts?.run ? { type: 'run', script: scripts.run, shellSetup } : undefined,
              signal: control.signal,
              deadlineAt: control.deadlineAt,
              runStartupGraceMs: context.strictStartup?.runStartupGraceMs,
              waitForPreview: context.strictStartup?.requirePreview
                ? ({ signal }) =>
                    waitForWorkspacePreview({
                      projectId: context.projectId,
                      workspaceId,
                      signal,
                      timeoutMs: capWorkspaceFactoryTimeout(
                        context.strictStartup?.previewTimeoutMs ?? 60_000,
                        control.deadlineAt
                      ),
                      pollIntervalMs: context.strictStartup?.previewPollIntervalMs,
                    })
                : undefined,
            },
            startNormal: async () => {
              if (scripts?.setup && (projectSettings.autoRunSetupScriptOnTaskCreation ?? true)) {
                const setupResult = await runLifecycleScriptWithPolicy({
                  workspace: ws,
                  projectId: context.projectId,
                  taskId: context.task.id,
                  workspaceId,
                  type: 'setup',
                  script: scripts.setup,
                  shellSetup,
                  origin: 'auto-setup',
                  policy: {
                    respawnAfterExit: true,
                    logFailure: true,
                    surfaceFailure: true,
                    continueOnFailure: true,
                  },
                  logPrefix,
                });
                if (setupResult.kind !== 'succeeded') return;
              }

              if (scripts?.run && (projectSettings.autoRunRunScriptOnTaskCreation ?? false)) {
                await runLifecycleScriptWithPolicy({
                  workspace: ws,
                  projectId: context.projectId,
                  taskId: context.task.id,
                  workspaceId,
                  type: 'run',
                  script: scripts.run,
                  shellSetup,
                  origin: 'auto-run',
                  policy: {
                    respawnAfterExit: true,
                    logFailure: true,
                    surfaceFailure: true,
                    continueOnFailure: true,
                  },
                  logPrefix,
                });
              }
            },
          });
        },

        onCreate: context.extraHooks?.onCreate,

        onDestroy: async (ws) => {
          await previewServerService.stopForWorkspace(context.projectId, workspaceId);
          if (ownsFetchService) {
            gitRepositoryFetchService.stop();
          }
          workspaceFileIndexService.onWorkspaceDeactivated(workspaceId);
          const latestProjectSettings = await context.settings.get();
          const latestTaskSettings = await getEffectiveTaskSettings({
            projectSettings: context.settings,
            taskFs: ws.fileSystem,
            taskConfigPath: ws.configPath,
          });
          const latestShellSetup =
            latestTaskSettings.shellSetup ?? latestProjectSettings.shellSetup;
          const teardownScript = latestTaskSettings.scripts?.teardown;

          if (teardownScript) {
            await runLifecycleScriptWithPolicy({
              workspace: ws,
              projectId: context.projectId,
              taskId: context.task.id,
              workspaceId,
              type: 'teardown',
              script: teardownScript,
              shellSetup: latestShellSetup,
              origin: 'workspace-destroy',
              policy: {
                timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
                logFailure: true,
                surfaceFailure: false,
                continueOnFailure: true,
              },
              logPrefix,
            });
          }
          await context.extraHooks?.onDestroy?.(ws);
        },

        onDetach: async (ws) => {
          await previewServerService.stopForWorkspace(context.projectId, workspaceId);
          await context.extraHooks?.onDetach?.(ws);
        },
      };
    } catch (error) {
      return failWorkspaceFactoryAfterCleanup(
        error,
        createRetryableWorkspaceFactoryCleanup([
          ...(fileTreeProjector ? [async () => fileTreeProjector.dispose()] : []),
          ...(lifecycleService ? [() => lifecycleService.dispose()] : []),
          () => runtime.release(),
        ])
      );
    }
  };
}

export function dispatchWorkspaceLifecycleStartup({
  strict,
  lifecycleService,
  required,
  startNormal,
}: {
  strict: boolean;
  lifecycleService: Pick<LifecycleScriptService, 'startRequiredStartup'>;
  required: RequiredLifecycleStartup;
  startNormal(): Promise<void>;
}): void {
  if (strict) {
    lifecycleService.startRequiredStartup(required);
    return;
  }
  void startNormal();
}

export async function waitForWorkspacePreview({
  projectId,
  workspaceId,
  signal,
  timeoutMs = 60_000,
  pollIntervalMs = 100,
  previewServers = previewServerService,
}: {
  projectId: string;
  workspaceId: string;
  signal: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  previewServers?: Pick<typeof previewServerService, 'listForWorkspace'>;
}): Promise<Result<void, LifecyclePreviewStartupError>> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted) {
    const previews = previewServers.listForWorkspace({ projectId, workspaceId });
    if (previews.length > 1) {
      return err({
        type: 'preview-ambiguous',
        stage: 'preview',
        message: 'Multiple previews were detected; select one before clean-room verification.',
      });
    }
    const preview = previews[0];
    if (preview?.status.kind === 'failed') {
      return err({
        type: 'preview-failed',
        stage: 'preview',
        message: 'The required preview failed to start.',
      });
    }
    if (preview?.status.kind === 'ready' && previewServerUrl(preview)) {
      return ok();
    }
    if (Date.now() >= deadline) {
      return err({
        type: 'preview-timeout',
        stage: 'preview',
        message: 'Preview did not become ready before the timeout.',
      });
    }
    try {
      await abortableDelay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
    } catch {
      break;
    }
  }
  return err({
    type: 'preview-failed',
    stage: 'preview',
    message: 'Preview readiness was cancelled.',
  });
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function acquireWorkspaceRuntime(
  workspaceRuntime: WorkspaceFactoryContext['workspaceRuntime'],
  workDir: string,
  control: WorkspaceAcquireControl
) {
  const runtimeOperation = workspaceRuntime.manager.acquire(workspaceRuntime.machine);
  let runtimeLease;
  try {
    runtimeLease = await awaitWithWorkspaceFactoryControl(runtimeOperation, control);
  } catch (error) {
    let lateRuntimeLease;
    try {
      lateRuntimeLease = await runtimeOperation;
    } catch {
      throw error;
    }
    return failWorkspaceFactoryAfterCleanup(
      error,
      createRetryableWorkspaceFactoryCleanup([() => lateRuntimeLease.release()])
    );
  }

  const openWorktree = () => runtimeLease.value.git.openWorktree(workDir);
  let worktreeOperation: ReturnType<typeof openWorktree>;
  try {
    worktreeOperation = openWorktree();
  } catch (error) {
    return failWorkspaceFactoryAfterCleanup(
      error,
      createRetryableWorkspaceFactoryCleanup([() => runtimeLease.release()])
    );
  }
  let worktreeLease;
  try {
    worktreeLease = await awaitWithWorkspaceFactoryControl(worktreeOperation, control);
  } catch (error) {
    let lateWorktreeLease;
    try {
      lateWorktreeLease = await worktreeOperation;
    } catch {
      return failWorkspaceFactoryAfterCleanup(
        error,
        createRetryableWorkspaceFactoryCleanup([() => runtimeLease.release()])
      );
    }
    return failWorkspaceFactoryAfterCleanup(
      error,
      createRetryableWorkspaceFactoryCleanup([
        () => lateWorktreeLease.release(),
        () => runtimeLease.release(),
      ])
    );
  }

  const openFileTree = () => runtimeLease.value.files.openTree(workDir);
  let fileTreeOperation: ReturnType<typeof openFileTree>;
  try {
    fileTreeOperation = openFileTree();
  } catch (error) {
    return failWorkspaceFactoryAfterCleanup(
      error,
      createRetryableWorkspaceFactoryCleanup([
        () => worktreeLease.release(),
        () => runtimeLease.release(),
      ])
    );
  }
  let openedFileTree;
  try {
    openedFileTree = await awaitWithWorkspaceFactoryControl(fileTreeOperation, control);
  } catch (error) {
    let lateFileTree;
    try {
      lateFileTree = await fileTreeOperation;
    } catch {
      return failWorkspaceFactoryAfterCleanup(
        error,
        createRetryableWorkspaceFactoryCleanup([
          () => worktreeLease.release(),
          () => runtimeLease.release(),
        ])
      );
    }
    return failWorkspaceFactoryAfterCleanup(
      error,
      createRetryableWorkspaceFactoryCleanup([
        ...(lateFileTree.success ? [() => lateFileTree.data.release()] : []),
        () => worktreeLease.release(),
        () => runtimeLease.release(),
      ])
    );
  }

  if (!openedFileTree.success) {
    return failWorkspaceFactoryAfterCleanup(
      new Error(`Failed to open file tree: ${JSON.stringify(openedFileTree.error)}`),
      createRetryableWorkspaceFactoryCleanup([
        () => worktreeLease.release(),
        () => runtimeLease.release(),
      ])
    );
  }
  const fileTreeLease = openedFileTree.data;
  const completed = { fileTree: false, worktree: false, runtime: false };
  let released = false;
  let releaseOperation: Promise<void> | undefined;
  return {
    gitWorktree: worktreeLease.value,
    fileTree: fileTreeLease.value,
    filesRuntime: runtimeLease.value.files,
    release: () => {
      if (released) return Promise.resolve();
      if (releaseOperation) return releaseOperation;
      const current = runWorkspaceFactoryCleanup([
        ...(!completed.fileTree
          ? [
              async () => {
                await fileTreeLease.release();
                completed.fileTree = true;
              },
            ]
          : []),
        ...(!completed.worktree
          ? [
              async () => {
                await worktreeLease.release();
                completed.worktree = true;
              },
            ]
          : []),
        ...(!completed.runtime
          ? [
              async () => {
                await runtimeLease.release();
                completed.runtime = true;
              },
            ]
          : []),
      ]).then(() => {
        released = true;
      });
      releaseOperation = current;
      void current.catch(() => {
        if (releaseOperation === current) releaseOperation = undefined;
      });
      return current;
    },
  };
}

function workspaceFactoryStopped(control: WorkspaceAcquireControl): boolean {
  return Boolean(
    control.signal?.aborted ||
    (control.deadlineAt !== undefined && control.deadlineAt <= Date.now())
  );
}

function throwIfWorkspaceFactoryStopped(control: WorkspaceAcquireControl): void {
  if (workspaceFactoryStopped(control)) {
    throw new DOMException('Workspace factory operation was cancelled.', 'AbortError');
  }
}

function awaitWithWorkspaceFactoryControl<T>(
  operation: Promise<T>,
  control: WorkspaceAcquireControl
): Promise<T> {
  if (workspaceFactoryStopped(control)) {
    return Promise.reject(
      new DOMException('Workspace factory operation was cancelled.', 'AbortError')
    );
  }
  if (!control.signal && control.deadlineAt === undefined) return operation;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      control.signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() =>
        reject(new DOMException('Workspace factory operation was cancelled.', 'AbortError'))
      );
    const remaining =
      control.deadlineAt === undefined ? undefined : Math.max(0, control.deadlineAt - Date.now());
    const timer = remaining === undefined ? undefined : setTimeout(onAbort, remaining);
    timer?.unref?.();
    control.signal?.addEventListener('abort', onAbort, { once: true });
    if (control.signal?.aborted) onAbort();
    operation.then(
      (value) => {
        if (workspaceFactoryStopped(control)) {
          onAbort();
          return;
        }
        finish(() => resolve(value));
      },
      (error) => finish(() => reject(error))
    );
  });
}

async function awaitWithWorkspaceFactoryReadQuiescence<T>(
  operation: Promise<T>,
  control: WorkspaceAcquireControl
): Promise<T> {
  try {
    return await awaitWithWorkspaceFactoryControl(operation, control);
  } catch (error) {
    await operation.catch(() => {});
    throw error;
  }
}

async function runWorkspaceFactoryCleanup(operations: Array<() => Promise<void>>): Promise<void> {
  let firstFailure: unknown;
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
}

function createRetryableWorkspaceFactoryCleanup(
  operations: Array<() => Promise<void>>
): () => Promise<void> {
  const completed = operations.map(() => false);
  return () =>
    runWorkspaceFactoryCleanup(
      operations.flatMap((operation, index) =>
        completed[index]
          ? []
          : [
              async () => {
                await operation();
                completed[index] = true;
              },
            ]
      )
    );
}

class WorkspaceFactoryQuiescenceFailure extends Error {
  readonly name = 'WorkspaceFactoryQuiescenceFailure';

  constructor(
    readonly operationFailure: unknown,
    private readonly retryCleanup: () => Promise<void>
  ) {
    super('Workspace factory cleanup did not quiesce.');
  }

  quiesce(): Promise<void> {
    return this.retryCleanup();
  }
}

async function failWorkspaceFactoryAfterCleanup(
  operationFailure: unknown,
  cleanup: () => Promise<void>
): Promise<never> {
  try {
    await cleanup();
  } catch {
    throw new WorkspaceFactoryQuiescenceFailure(operationFailure, cleanup);
  }
  throw operationFailure;
}

function capWorkspaceFactoryTimeout(timeoutMs: number, deadlineAt: number | undefined): number {
  return deadlineAt === undefined
    ? timeoutMs
    : Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now()));
}

type TaskProviderOpts = {
  projectId: string;
  taskId: string;
  workspaceId: string;
  taskPath: string;
  tmuxEnabled: boolean;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
  filesRuntime?: IFilesRuntime;
};

async function resolveLocalConversationShellProfile(taskId: string): Promise<ResolvedShellProfile> {
  const { defaultShell } = await appSettingsService.get('terminal');
  return await resolveLocalAutomationShellWithSystemFallback({
    intent: defaultShell,
    onFallback: (error) => {
      log.warn(
        'buildTaskProviders: preferred local conversation shell unavailable, using fallback',
        {
          shell: error.shell,
          taskId,
        }
      );
    },
  });
}

/**
 * Creates task-scoped conversation and terminal providers for the given transport type.
 * The exec function is derived internally from the WorkspaceType.
 */
export async function buildTaskProviders(
  type: WorkspaceType,
  opts: TaskProviderOpts
): Promise<{ conversations: ConversationProvider; terminals: TerminalProvider }> {
  if (type.kind === 'ssh') {
    if (!opts.filesRuntime) {
      throw new Error('Missing SSH files runtime for SSH task provider');
    }
    const ctx = new SshExecutionContext(type.proxy, { connectionId: type.connectionId });
    return {
      conversations: new SshConversationProvider({
        projectId: opts.projectId,
        taskPath: opts.taskPath,
        taskId: opts.taskId,
        tmux: opts.tmuxEnabled,
        shellSetup: opts.shellSetup,
        ctx,
        proxy: type.proxy,
        filesRuntime: opts.filesRuntime,
        taskEnvVars: opts.taskEnvVars,
      }),
      terminals: new SshTerminalProvider({
        projectId: opts.projectId,
        workspaceId: opts.workspaceId,
        scopeId: opts.taskId,
        taskPath: opts.taskPath,
        tmux: opts.tmuxEnabled,
        shellSetup: opts.shellSetup,
        ctx,
        proxy: type.proxy,
        connectionId: type.connectionId,
        taskEnvVars: opts.taskEnvVars,
      }),
    };
  }

  const ctx = new LocalExecutionContext();
  const conversationShellProfile = await resolveLocalConversationShellProfile(opts.taskId);
  return {
    conversations: new LocalConversationProvider({
      projectId: opts.projectId,
      taskPath: opts.taskPath,
      taskId: opts.taskId,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      shellProfile: conversationShellProfile,
      ctx,
      taskEnvVars: opts.taskEnvVars,
    }),
    terminals: new LocalTerminalProvider({
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      scopeId: opts.taskId,
      taskPath: opts.taskPath,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      ctx,
      taskEnvVars: opts.taskEnvVars,
    }),
  };
}

/**
 * Resolves the task-level environment variables and settings from an already-acquired workspace.
 * Used by providers after `workspaceRegistry.acquire` to avoid duplicating settings reads.
 */
export async function resolveTaskEnv(
  task: Pick<Task, 'id' | 'name'>,
  workspace: Pick<Workspace, 'path' | 'fileSystem' | 'configPath'>,
  projectPath: string,
  settings: ProjectSettingsProvider
): Promise<{
  taskEnvVars: Record<string, string>;
  tmuxEnabled: boolean;
  shellSetup?: string;
}> {
  const projectSettings = await settings.get();
  const defaultBranch = await settings.getDefaultBranch();
  const taskLevelSettings = await getEffectiveTaskSettings({
    projectSettings: settings,
    taskFs: workspace.fileSystem,
    taskConfigPath: workspace.configPath,
  });
  return {
    taskEnvVars: getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: workspace.path,
      projectPath,
      defaultBranch,
      portSeed: workspace.path,
    }),
    tmuxEnabled: projectSettings.tmux ?? false,
    shellSetup: taskLevelSettings.shellSetup ?? projectSettings.shellSetup,
  };
}
