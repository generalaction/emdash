import type { IFilesRuntime } from '@main/core/runtime/types';
import type { Workspace } from './workspace';

export type TeardownMode = 'detach' | 'terminate';

type WorkspaceHooks = {
  onCreate?: (workspace: Workspace) => Promise<void>;
  onCreateSideEffect?: (workspace: Workspace) => void;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

export type WorkspaceAcquireResult = {
  workspace: Workspace;
  /** Transitional SSH-only capability for legacy SSH conversation adapters. */
  sshFilesRuntime?: IFilesRuntime;
};

export type WorkspaceFactoryResult = WorkspaceAcquireResult & WorkspaceHooks;

export type WorkspaceAcquireControl = {
  signal?: AbortSignal;
  deadlineAt?: number;
};

type WorkspaceFactory = (control?: WorkspaceAcquireControl) => Promise<WorkspaceFactoryResult>;

type WorkspaceEntry = {
  workspace: Workspace;
  sshFilesRuntime?: IFilesRuntime;
  refCount: number;
  projectId: string;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
  /** Single-flight release of the workspace's native leases. */
  release: () => Promise<void>;
  teardown?: Promise<void>;
  teardownMode?: TeardownMode;
  cleanup: {
    destroyHook: boolean;
    detachHook: boolean;
    release: boolean;
    lifecycle: boolean;
  };
};

type WorkspaceAcquisition = {
  key: string;
  projectId: string;
  waiters: number;
  orphaned: boolean;
  sideEffectsStarted: boolean;
  entry?: WorkspaceEntry;
  result?: WorkspaceFactoryResult;
  disposeResult?: () => Promise<void>;
  disposal?: Promise<void>;
  failure?: unknown;
  quiescence?: Promise<void>;
  controller: AbortController;
  promise: Promise<WorkspaceAcquireResult>;
};

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private acquiring = new Map<string, WorkspaceAcquisition>();
  private orphanedAcquisitions = new Map<string, WorkspaceAcquisition>();

  async acquire(
    key: string,
    projectId: string,
    factory: WorkspaceFactory,
    control: WorkspaceAcquireControl = {}
  ): Promise<WorkspaceAcquireResult> {
    throwIfWorkspaceAcquireStopped(control);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.teardown || existing.refCount === 0) {
        const teardown =
          existing.teardown ??
          this.teardownEntry(key, existing, existing.teardownMode ?? 'terminate');
        await awaitWithWorkspaceAcquireControl(teardown, control);
        return this.acquire(key, projectId, factory, control);
      }
      existing.refCount += 1;
      return { workspace: existing.workspace, sshFilesRuntime: existing.sshFilesRuntime };
    }
    const orphaned = this.orphanedAcquisitions.get(key);
    if (orphaned) {
      await awaitWithWorkspaceAcquireControl(this.quiesceAcquisition(orphaned), control);
      return this.acquire(key, projectId, factory, control);
    }

    const inFlight = this.acquiring.get(key);
    if (inFlight) {
      return this.waitForAcquisition(inFlight, control);
    }

    const acquisition = {
      key,
      projectId,
      waiters: 0,
      orphaned: false,
      sideEffectsStarted: false,
      controller: new AbortController(),
    } as WorkspaceAcquisition;
    let resolveAcquisition: (result: WorkspaceAcquireResult) => void = () => {};
    let rejectAcquisition: (error: unknown) => void = () => {};
    acquisition.promise = new Promise<WorkspaceAcquireResult>((resolve, reject) => {
      resolveAcquisition = resolve;
      rejectAcquisition = reject;
    });
    this.acquiring.set(key, acquisition);
    void this.runAcquisition(acquisition, factory).then(resolveAcquisition, rejectAcquisition);
    return this.waitForAcquisition(acquisition, control);
  }

  async teardown(key: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      const inFlight = this.acquiring.get(key) ?? this.orphanedAcquisitions.get(key);
      if (inFlight) {
        this.orphanAcquisition(inFlight);
        await this.quiesceAcquisition(inFlight);
      }
      return;
    }

    if (entry.refCount > 1) {
      entry.refCount -= 1;
      return;
    }

    entry.refCount = 0;
    await this.teardownEntry(key, entry, mode);
  }

  get(key: string): Workspace | undefined {
    const entry = this.entries.get(key);
    return entry && entry.refCount > 0 && !entry.teardown ? entry.workspace : undefined;
  }

  listForProject(projectId: string): { workspaceId: string; path: string }[] {
    return Array.from(this.entries.entries())
      .filter(([, entry]) => entry.projectId === projectId)
      .filter(([, entry]) => entry.refCount > 0 && !entry.teardown)
      .map(([workspaceId, entry]) => ({ workspaceId, path: entry.workspace.path }));
  }

  refCount(key: string): number {
    return this.entries.get(key)?.refCount ?? 0;
  }

  async teardownAllForProject(projectId: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const keys = new Set(
      [
        ...this.entries.entries(),
        ...this.acquiring.entries(),
        ...this.orphanedAcquisitions.entries(),
      ]
        .filter(([, value]) => value.projectId === projectId)
        .map(([key]) => key)
    );
    await Promise.all(Array.from(keys).map((key) => this.teardown(key, mode)));
  }

  async teardownAll(mode: TeardownMode = 'terminate'): Promise<void> {
    const keys = new Set([
      ...this.entries.keys(),
      ...this.acquiring.keys(),
      ...this.orphanedAcquisitions.keys(),
    ]);
    await Promise.all(
      Array.from(keys).map((key) => {
        const entry = this.entries.get(key);
        if (entry) entry.refCount = 0;
        return this.teardown(key, mode);
      })
    );
  }

  async releaseLeasesForProject(projectId: string): Promise<void> {
    const entries = Array.from(this.entries.values()).filter(
      (entry) => entry.projectId === projectId
    );
    await Promise.all(entries.map((entry) => entry.release()));
  }

  private async runAcquisition(
    acquisition: WorkspaceAcquisition,
    factory: WorkspaceFactory
  ): Promise<WorkspaceAcquireResult> {
    try {
      const result = await factory({ signal: acquisition.controller.signal });
      acquisition.result = result;
      if (acquisition.orphaned || acquisition.waiters === 0) {
        await this.disposeAcquisition(acquisition);
        throw workspaceAcquireAbortError();
      }

      if (result.onCreateSideEffect) {
        acquisition.sideEffectsStarted = true;
        result.onCreateSideEffect(result.workspace);
      }
      if (result.onCreate) {
        acquisition.sideEffectsStarted = true;
        await result.onCreate(result.workspace);
      }
      if (acquisition.orphaned || acquisition.waiters === 0) {
        await this.disposeAcquisition(acquisition);
        throw workspaceAcquireAbortError();
      }

      return { workspace: result.workspace, sshFilesRuntime: result.sshFilesRuntime };
    } catch (error) {
      let propagated = error;
      if (acquisition.result && !acquisition.entry) {
        try {
          await this.disposeAcquisition(acquisition);
        } catch {
          propagated = new WorkspaceAcquisitionQuiescenceFailure(error, () =>
            this.disposeAcquisition(acquisition)
          );
        }
      }
      acquisition.failure = propagated;
      if (isWorkspaceFactoryQuiescenceFailure(propagated)) {
        this.orphanAcquisition(acquisition);
      }
      throw propagated;
    }
  }

  private async waitForAcquisition(
    acquisition: WorkspaceAcquisition,
    control: WorkspaceAcquireControl
  ): Promise<WorkspaceAcquireResult> {
    acquisition.waiters += 1;
    let stopped = false;
    try {
      const result = await awaitWithWorkspaceAcquireControl(acquisition.promise, control);
      throwIfWorkspaceAcquireStopped(control);
      if (acquisition.orphaned) throw workspaceAcquireAbortError();
      const factoryResult = acquisition.result;
      if (!factoryResult) throw workspaceAcquireAbortError();
      const entry = acquisition.entry ?? createWorkspaceEntry(acquisition.projectId, factoryResult);
      if (!acquisition.entry) {
        acquisition.entry = entry;
        this.entries.set(acquisition.key, entry);
      }
      if (this.entries.get(acquisition.key) !== entry || entry.teardown) {
        throw workspaceAcquireAbortError();
      }
      entry.refCount += 1;
      return result;
    } catch (error) {
      stopped = error instanceof WorkspaceAcquireWaiterStopped || workspaceAcquireStopped(control);
      throw error;
    } finally {
      acquisition.waiters -= 1;
      if (acquisition.waiters === 0 && this.acquiring.get(acquisition.key) === acquisition) {
        this.acquiring.delete(acquisition.key);
      }
      if (stopped && acquisition.waiters === 0 && (acquisition.entry?.refCount ?? 0) === 0) {
        this.orphanAcquisition(acquisition);
      }
    }
  }

  private orphanAcquisition(acquisition: WorkspaceAcquisition): void {
    if (acquisition.orphaned) return;
    acquisition.orphaned = true;
    acquisition.controller.abort(workspaceAcquireAbortError());
    if (this.acquiring.get(acquisition.key) === acquisition) {
      this.acquiring.delete(acquisition.key);
    }
    this.orphanedAcquisitions.set(acquisition.key, acquisition);
    if (acquisition.entry?.refCount === 0) {
      if (this.entries.get(acquisition.key) === acquisition.entry) {
        this.entries.delete(acquisition.key);
      }
      void this.disposeAcquisition(acquisition).catch(() => {});
    }
    void this.quiesceAcquisition(acquisition).catch(() => {});
  }

  private disposeAcquisition(acquisition: WorkspaceAcquisition): Promise<void> {
    if (acquisition.disposal) return acquisition.disposal;
    const result = acquisition.result;
    if (!result) return Promise.resolve();
    acquisition.disposeResult ??= createUnregisteredWorkspaceDisposer(
      result,
      acquisition.sideEffectsStarted
    );
    const operation = acquisition.disposeResult();
    acquisition.disposal = operation;
    void operation.catch(() => {
      if (acquisition.disposal === operation) acquisition.disposal = undefined;
    });
    return operation;
  }

  private async quiesceAcquisition(acquisition: WorkspaceAcquisition): Promise<void> {
    if (!acquisition.quiescence) {
      const operation = this.runAcquisitionQuiescence(acquisition);
      acquisition.quiescence = operation;
      void operation.catch(() => {
        if (acquisition.quiescence === operation) acquisition.quiescence = undefined;
      });
    }
    return acquisition.quiescence;
  }

  private async runAcquisitionQuiescence(acquisition: WorkspaceAcquisition): Promise<void> {
    await acquisition.promise.catch(() => {});
    if (isWorkspaceFactoryQuiescenceFailure(acquisition.failure)) {
      await acquisition.failure.quiesce();
    }
    if (acquisition.result && acquisition.orphaned) {
      await this.disposeAcquisition(acquisition);
    }
    if (this.orphanedAcquisitions.get(acquisition.key) === acquisition) {
      this.orphanedAcquisitions.delete(acquisition.key);
    }
  }

  private async teardownEntry(
    key: string,
    entry: WorkspaceEntry,
    mode: TeardownMode
  ): Promise<void> {
    if (!entry.teardown) {
      entry.teardownMode ??= mode;
      const operation = runEntryTeardown(entry, entry.teardownMode);
      entry.teardown = operation;
      void operation.then(
        () => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
        },
        () => {
          if (entry.teardown === operation) entry.teardown = undefined;
        }
      );
    }
    return entry.teardown;
  }
}

class WorkspaceAcquisitionQuiescenceFailure extends Error {
  readonly name = 'WorkspaceAcquisitionQuiescenceFailure';

  constructor(
    readonly acquisitionFailure: unknown,
    private readonly retryCleanup: () => Promise<void>
  ) {
    super('Workspace acquisition cleanup did not quiesce.');
  }

  quiesce(): Promise<void> {
    return this.retryCleanup();
  }
}

class WorkspaceAcquireWaiterStopped extends DOMException {
  constructor() {
    super('Workspace acquisition was cancelled.', 'AbortError');
  }
}

function isWorkspaceFactoryQuiescenceFailure(
  error: unknown
): error is { quiesce(): Promise<void> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'quiesce' in error &&
    typeof error.quiesce === 'function'
  );
}

function createWorkspaceEntry(projectId: string, result: WorkspaceFactoryResult): WorkspaceEntry {
  return {
    workspace: result.workspace,
    sshFilesRuntime: result.sshFilesRuntime,
    refCount: 0,
    projectId,
    onDestroy: result.onDestroy,
    onDetach: result.onDetach,
    release: createWorkspaceRelease(result.workspace),
    cleanup: {
      destroyHook: false,
      detachHook: false,
      release: false,
      lifecycle: false,
    },
  };
}

function createWorkspaceRelease(workspace: Workspace): () => Promise<void> {
  let completed = false;
  let operation: Promise<void> | undefined;
  const fallbackCompleted = { fileTree: false, gitWorktree: false };
  return () => {
    if (completed) return Promise.resolve();
    if (operation) return operation;
    const current = runAllCleanupOperations(
      workspace.dispose
        ? [() => workspace.dispose!()]
        : [
            ...(!fallbackCompleted.fileTree
              ? [
                  async () => {
                    await workspace.fileTree.dispose();
                    fallbackCompleted.fileTree = true;
                  },
                ]
              : []),
            ...(!fallbackCompleted.gitWorktree
              ? [
                  async () => {
                    await workspace.gitWorktree.dispose();
                    fallbackCompleted.gitWorktree = true;
                  },
                ]
              : []),
          ]
    ).then(() => {
      completed = true;
    });
    operation = current;
    void current.catch(() => {
      if (operation === current) operation = undefined;
    });
    return current;
  };
}

function createUnregisteredWorkspaceDisposer(
  result: WorkspaceFactoryResult,
  sideEffectsStarted: boolean
): () => Promise<void> {
  return createRetryableCleanup([
    ...(sideEffectsStarted && result.onDestroy ? [() => result.onDestroy!(result.workspace)] : []),
    createWorkspaceRelease(result.workspace),
    () => Promise.resolve(result.workspace.lifecycleService.dispose()),
  ]);
}

async function runEntryTeardown(entry: WorkspaceEntry, mode: TeardownMode): Promise<void> {
  const operations: Array<() => Promise<void>> = [];
  if (mode === 'terminate' && !entry.cleanup.destroyHook) {
    operations.push(async () => {
      await entry.onDestroy?.(entry.workspace);
      entry.cleanup.destroyHook = true;
    });
  }
  if (!entry.cleanup.release) {
    operations.push(async () => {
      await entry.release();
      entry.cleanup.release = true;
    });
  }
  if (!entry.cleanup.lifecycle) {
    operations.push(async () => {
      await entry.workspace.lifecycleService.dispose();
      entry.cleanup.lifecycle = true;
    });
  }
  if (mode === 'detach' && !entry.cleanup.detachHook) {
    operations.push(async () => {
      await entry.onDetach?.(entry.workspace);
      entry.cleanup.detachHook = true;
    });
  }
  await runAllCleanupOperations(operations);
}

async function runAllCleanupOperations(operations: Array<() => Promise<void>>): Promise<void> {
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

function createRetryableCleanup(operations: Array<() => Promise<void>>): () => Promise<void> {
  const completed = operations.map(() => false);
  return () =>
    runAllCleanupOperations(
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

function workspaceAcquireStopped(control: WorkspaceAcquireControl): boolean {
  return Boolean(
    control.signal?.aborted ||
    (control.deadlineAt !== undefined && control.deadlineAt <= Date.now())
  );
}

function throwIfWorkspaceAcquireStopped(control: WorkspaceAcquireControl): void {
  if (workspaceAcquireStopped(control)) throw new WorkspaceAcquireWaiterStopped();
}

function workspaceAcquireAbortError(): DOMException {
  return new DOMException('Workspace acquisition was cancelled.', 'AbortError');
}

function awaitWithWorkspaceAcquireControl<T>(
  operation: Promise<T>,
  control: WorkspaceAcquireControl
): Promise<T> {
  if (workspaceAcquireStopped(control)) {
    return Promise.reject(new WorkspaceAcquireWaiterStopped());
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
    const onAbort = () => finish(() => reject(new WorkspaceAcquireWaiterStopped()));
    const remaining =
      control.deadlineAt === undefined ? undefined : Math.max(0, control.deadlineAt - Date.now());
    const timer = remaining === undefined ? undefined : setTimeout(onAbort, remaining);
    timer?.unref?.();
    control.signal?.addEventListener('abort', onAbort, { once: true });
    if (control.signal?.aborted) onAbort();
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

export const workspaceRegistry = new WorkspaceRegistry();
