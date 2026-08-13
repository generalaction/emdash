import { randomUUID } from 'node:crypto';
import { formatHostRef } from '@emdash/core/primitives/host/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import {
  isRuntimeResolveError,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { type Scope } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import { cell, observe, peek, type Cell } from '@emdash/wire/state';
import type {
  AttachmentInvalidationCause,
  ProjectAttachmentError,
  ProjectAttachmentState,
  ProjectRecoveryRequestError,
} from '@core/features/projects/api/attachments';
import type {
  ProjectAttachmentManager,
  ProjectAttachmentManagerHooks,
} from '@core/features/projects/api/node/project-attachment-manager';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import { HookCore } from '@core/primitives/hooks/api/hookable';
import type { Project } from '@core/primitives/projects/api';
import { projectHostRef } from '@core/primitives/projects/api';
import type { HostAvailability } from '@core/services/hosts/api';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';

type RepositoryStat = {
  type: string;
};

type ProviderOpenError = RuntimeResolveError | { type: 'error'; message: string };

export type ProjectAttachmentAdapter = {
  loadProject(projectId: string): Promise<Project | undefined>;
  statRepository(
    project: Project,
    signal: AbortSignal
  ): Promise<Result<RepositoryStat, FsError | RuntimeResolveError>>;
  open(project: Project, signal: AbortSignal): Promise<Result<ProjectProvider, ProviderOpenError>>;
};

export type CreateProjectAttachmentManagerOptions = {
  scope: Scope;
  availability: HostAvailability;
  adapter: ProjectAttachmentAdapter;
  createAttemptId?: () => string;
};

type AttachmentEntry = {
  projectId: string;
  scope: Scope;
  hostScope?: Scope;
  state: Cell<ProjectAttachmentState>;
  leases: number;
  project?: Project;
  provider?: ProjectProvider;
  providerReleased?: boolean;
  attempt?: {
    id: string;
    hostGeneration: number;
    projectIdentity: string;
    scope: Scope;
    promise: Promise<void>;
  };
};

export class ProjectAttachmentManagerService implements ProjectAttachmentManager {
  private readonly scope: Scope;
  private readonly entries = new Map<string, AttachmentEntry>();
  private readonly legacyOwners = new Map<string, Scope>();
  private readonly recoveries = new Map<
    string,
    Promise<Result<void, ProjectRecoveryRequestError>>
  >();
  private readonly hooks = new HookCore<ProjectAttachmentManagerHooks>((name, error) =>
    log.error(`ProjectAttachmentManager: ${String(name)} hook error`, { error })
  );
  private readonly createAttemptId: () => string;
  private disposed = false;
  private releaseStarted = false;
  private releasePromise: Promise<void> | undefined;

  constructor(private readonly options: CreateProjectAttachmentManagerOptions) {
    this.scope = options.scope.child('project-attachments');
    this.createAttemptId = options.createAttemptId ?? randomUUID;
  }

  track(projectId: string, owner: Scope): Cell<ProjectAttachmentState> {
    let entry = this.entries.get(projectId);
    if (!entry) {
      entry = {
        projectId,
        scope: this.scope.child(projectId),
        state: cell<ProjectAttachmentState>({ kind: 'absent' }),
        leases: 0,
      };
      this.entries.set(projectId, entry);
      void this.initializeEntry(entry);
    }
    entry.leases += 1;
    let released = false;
    owner.add(async () => {
      if (released) return;
      released = true;
      await this.releaseLease(entry);
    });
    return entry.state;
  }

  recover(projectId: string): Promise<Result<void, ProjectRecoveryRequestError>> {
    const existing = this.recoveries.get(projectId);
    if (existing) return existing;
    const request = this.performRecovery(projectId);
    this.recoveries.set(projectId, request);
    void request.then(
      () => this.clearRecovery(projectId, request),
      () => this.clearRecovery(projectId, request)
    );
    return request;
  }

  private async performRecovery(
    projectId: string
  ): Promise<Result<void, ProjectRecoveryRequestError>> {
    const entry = this.entries.get(projectId);
    const project = await this.options.adapter.loadProject(projectId);
    if (!project) {
      if (entry) {
        await this.cancelAttempt(entry);
        await this.disposeProvider(entry);
        await entry.hostScope?.dispose();
        entry.hostScope = undefined;
        entry.project = undefined;
        entry.state.set({
          kind: 'absent',
          lastFailure: { type: 'project-missing', projectId },
        });
      }
      return err({ type: 'project-missing', projectId });
    }
    const recoveryCause = project.type === 'ssh' ? 'connect' : 'retry';
    if (entry) {
      if (
        entry.provider &&
        entry.project &&
        attachmentTargetIdentity(entry.project) === attachmentTargetIdentity(project)
      ) {
        entry.project = project;
        this.options.availability.requestReady(projectHostRef(project), recoveryCause);
        return ok();
      }
      await this.cancelAttempt(entry);
      await this.disposeProvider(entry);
      entry.project = project;
      entry.state.set({ kind: 'absent' });
      this.bindHost(entry, project);
    }
    this.options.availability.requestReady(projectHostRef(project), recoveryCause);
    return ok();
  }

  private clearRecovery(
    projectId: string,
    request: Promise<Result<void, ProjectRecoveryRequestError>>
  ): void {
    if (this.recoveries.get(projectId) === request) this.recoveries.delete(projectId);
  }

  requireAttached(projectId: string): Result<ProjectProvider, ProjectAttachmentError> {
    const entry = this.entries.get(projectId);
    if (!entry?.project) return err({ type: 'project-missing', projectId });
    const host = projectHostRef(entry.project);
    const ready = this.options.availability.requireReady(host);
    if (!ready.success) return ready;
    if (entry.provider) return ok(entry.provider);
    const state = peek(entry.state);
    if (state.kind === 'absent' && state.lastFailure) return err(state.lastFailure);
    return err({
      type: 'attachment-unavailable',
      host,
      phase: state.kind === 'attaching' ? 'attaching' : 'waiting',
    });
  }

  async invalidate(projectId: string, cause: AttachmentInvalidationCause): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    await this.cancelAttempt(entry);
    await this.disposeProvider(entry);
    await entry.hostScope?.dispose();
    entry.hostScope = undefined;
    entry.project = undefined;
    entry.state.set({ kind: 'absent' });
    if (cause === 'deletion' || cause === 'owner-released' || cause === 'shutdown') return;
    await this.initializeEntry(entry);
  }

  async openProject(
    project: Project | string
  ): Promise<Result<ProjectProvider, ProjectAttachmentError>> {
    const projectId = typeof project === 'string' ? project : project.id;
    let owner = this.legacyOwners.get(projectId);
    const currentState = this.entries.get(projectId);
    const currentSnapshot = currentState ? peek(currentState.state) : undefined;
    if (owner && currentSnapshot?.kind === 'absent' && currentSnapshot.lastFailure) {
      const recovered = await this.recover(projectId);
      if (!recovered.success) return recovered;
    } else if (!owner) {
      owner = this.scope.child(`legacy:${projectId}`);
      this.legacyOwners.set(projectId, owner);
      this.track(projectId, owner);
    }
    await this.initializeEntry(this.entries.get(projectId)!);
    const canonical = this.entries.get(projectId)?.project;
    if (!canonical) {
      await owner.dispose();
      this.legacyOwners.delete(projectId);
      return err({ type: 'project-missing', projectId });
    }
    const ready = await this.options.availability.ensureReady(projectHostRef(canonical), 'demand');
    if (!ready.success) return ready;
    const entry = this.entries.get(projectId);
    if (!entry) return err({ type: 'project-missing', projectId });
    this.startAttempt(entry, ready.data.generation);
    await entry.attempt?.promise;
    return this.requireAttached(projectId);
  }

  async closeProject(
    projectId: string,
    cause: AttachmentInvalidationCause = 'owner-released'
  ): Promise<Result<void, ProjectAttachmentError>> {
    const owner = this.legacyOwners.get(projectId);
    if (owner) {
      this.legacyOwners.delete(projectId);
      await owner.dispose();
    }
    if (this.entries.has(projectId)) {
      await this.invalidate(projectId, cause);
    }
    return ok();
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this.entries.get(projectId)?.provider;
  }

  on<K extends keyof ProjectAttachmentManagerHooks>(
    name: K,
    handler: ProjectAttachmentManagerHooks[K]
  ) {
    return this.hooks.on(name, handler);
  }

  async release(): Promise<void> {
    this.releasePromise ??= (async () => {
      this.releaseStarted = true;
      const entries = [...this.entries.values()];
      const cancellations = await Promise.allSettled(
        entries.map((entry) => this.cancelAttempt(entry))
      );
      const releases = await Promise.allSettled(
        entries.map(async (entry) => {
          if (!entry.provider || entry.providerReleased) return;
          entry.providerReleased = true;
          await entry.provider.release();
        })
      );
      const failures = [...cancellations, ...releases].filter(
        (result) => result.status === 'rejected'
      );
      for (const failure of failures) {
        log.error('ProjectAttachmentManager: failed to release Provider', {
          error: failure.reason,
        });
      }
      if (failures.length > 0) throw failures[0].reason;
    })();
    return this.releasePromise;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.legacyOwners.clear();
    const entries = [...this.entries.values()];
    this.entries.clear();
    const results = await Promise.allSettled(entries.map((entry) => this.disposeEntry(entry)));
    await this.scope.dispose();
    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('ProjectAttachmentManager: failed to dispose Provider', {
          error: result.reason,
        });
      }
    }
  }

  private async initializeEntry(entry: AttachmentEntry): Promise<void> {
    if (this.entries.get(entry.projectId) !== entry) return;
    let project: Project | undefined;
    try {
      project = await this.options.adapter.loadProject(entry.projectId);
    } catch (error) {
      if (this.entries.get(entry.projectId) !== entry) return;
      entry.state.set({
        kind: 'absent',
        lastFailure: {
          type: 'unexpected',
          stage: 'repository-stat',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }
    if (this.entries.get(entry.projectId) !== entry) return;
    if (!project) {
      entry.project = undefined;
      entry.state.set({
        kind: 'absent',
        lastFailure: { type: 'project-missing', projectId: entry.projectId },
      });
      return;
    }
    entry.project = project;
    this.bindHost(entry, project);
    void this.options.availability.ensureReady(projectHostRef(project), 'demand');
  }

  private bindHost(entry: AttachmentEntry, project: Project): void {
    void entry.hostScope?.dispose();
    const host = projectHostRef(project);
    const hostScope = entry.scope.child('host');
    entry.hostScope = hostScope;
    observe(
      this.options.availability.state(host),
      ({ value }) => {
        if (value.kind === 'ready') {
          this.startAttempt(entry, value.generation);
        } else if (entry.attempt) {
          void this.cancelAttempt(entry);
        }
      },
      { scope: hostScope, immediate: true }
    );
  }

  private startAttempt(entry: AttachmentEntry, hostGeneration: number): void {
    if (
      this.entries.get(entry.projectId) !== entry ||
      this.releaseStarted ||
      !entry.project ||
      entry.provider ||
      entry.attempt
    ) {
      return;
    }
    const current = peek(entry.state);
    if (
      current.kind === 'absent' &&
      current.lastFailure &&
      !isAutomaticallyEligibleFailure(current.lastFailure)
    ) {
      return;
    }
    if (current.kind === 'absent' && current.attemptedHostGeneration === hostGeneration) {
      return;
    }
    const attemptScope = entry.scope.child('attempt');
    const id = this.createAttemptId();
    entry.state.set({ kind: 'attaching', hostGeneration, attemptId: id });
    const attempt = {
      id,
      hostGeneration,
      projectIdentity: attachmentProjectIdentity(entry.project),
      scope: attemptScope,
      promise: Promise.resolve(),
    };
    entry.attempt = attempt;
    attempt.promise = this.performAttempt(entry, attempt);
  }

  private async performAttempt(
    entry: AttachmentEntry,
    attempt: NonNullable<AttachmentEntry['attempt']>
  ): Promise<void> {
    let stage: 'repository-stat' | 'session-open' = 'repository-stat';
    let uncommittedProvider: ProjectProvider | undefined;
    try {
      const project = await this.options.adapter.loadProject(entry.projectId);
      if (!project) {
        this.commitFailure(entry, attempt, {
          type: 'project-missing',
          projectId: entry.projectId,
        });
        return;
      }
      if (attachmentProjectIdentity(project) !== attempt.projectIdentity) {
        this.rejectStaleAttempt(entry, attempt, project);
        return;
      }
      const stat = await this.options.adapter.statRepository(project, attempt.scope.signal);
      if (!stat.success) {
        this.commitFailure(entry, attempt, repositoryStatError(project, stat.error));
        return;
      }
      if (stat.data.type !== 'directory') {
        this.commitFailure(entry, attempt, { type: 'repository-missing', path: project.path });
        return;
      }
      stage = 'session-open';
      const opened = await this.options.adapter.open(project, attempt.scope.signal);
      if (!opened.success) {
        const failure: ProjectAttachmentError = isRuntimeResolveError(opened.error)
          ? opened.error
          : { type: 'unexpected', stage: 'session-open', message: opened.error.message };
        this.commitFailure(entry, attempt, failure);
        return;
      }
      uncommittedProvider = opened.data;
      stage = 'repository-stat';
      const currentProject = await this.options.adapter.loadProject(entry.projectId);
      const ready = this.options.availability.requireReady(projectHostRef(project));
      if (
        entry.attempt !== attempt ||
        attempt.scope.disposed ||
        !currentProject ||
        attachmentProjectIdentity(currentProject) !== attempt.projectIdentity ||
        !ready.success ||
        ready.data.generation !== attempt.hostGeneration
      ) {
        if (entry.attempt === attempt) {
          this.rejectStaleAttempt(entry, attempt, currentProject);
        }
        uncommittedProvider = undefined;
        await opened.data.dispose();
        return;
      }
      entry.attempt = undefined;
      entry.project = project;
      entry.provider = opened.data;
      entry.providerReleased = false;
      uncommittedProvider = undefined;
      entry.state.set({
        kind: 'attached',
        establishedHostGeneration: attempt.hostGeneration,
      });
      this.hooks.callHookBackground('projectOpened', entry.projectId, opened.data);
      await attempt.scope.dispose();
    } catch (error) {
      const provider = uncommittedProvider;
      uncommittedProvider = undefined;
      if (provider) {
        await provider.dispose().catch((disposeError: unknown) => {
          log.warn('ProjectAttachmentManager: stale Provider disposal failed', {
            projectId: entry.projectId,
            error: disposeError,
          });
        });
      }
      this.commitFailure(entry, attempt, {
        type: 'unexpected',
        stage,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private commitFailure(
    entry: AttachmentEntry,
    attempt: NonNullable<AttachmentEntry['attempt']>,
    failure: ProjectAttachmentError
  ): void {
    if (entry.attempt !== attempt) return;
    entry.attempt = undefined;
    entry.state.set({
      kind: 'absent',
      lastFailure: failure,
      attemptedHostGeneration: attempt.hostGeneration,
    });
    if (isRuntimeResolveError(failure) && entry.project) {
      this.options.availability.invalidate(projectHostRef(entry.project), failure);
    }
    void attempt.scope.dispose();
  }

  private rejectStaleAttempt(
    entry: AttachmentEntry,
    attempt: NonNullable<AttachmentEntry['attempt']>,
    currentProject: Project | undefined
  ): void {
    if (entry.attempt !== attempt) return;
    entry.attempt = undefined;
    entry.project = currentProject;
    entry.state.set({
      kind: 'absent',
      attemptedHostGeneration: attempt.hostGeneration,
    });
    void attempt.scope.dispose();
    if (currentProject) this.bindHost(entry, currentProject);
  }

  private async cancelAttempt(entry: AttachmentEntry): Promise<void> {
    const attempt = entry.attempt;
    if (!attempt) return;
    entry.attempt = undefined;
    entry.state.set({
      kind: 'absent',
      attemptedHostGeneration: attempt.hostGeneration,
    });
    await attempt.scope.dispose();
  }

  private async disposeProvider(entry: AttachmentEntry): Promise<void> {
    const provider = entry.provider;
    if (!provider) return;
    entry.provider = undefined;
    entry.providerReleased = true;
    try {
      await provider.dispose();
    } finally {
      this.hooks.callHookBackground('projectClosed', entry.projectId);
    }
  }

  private async releaseLease(entry: AttachmentEntry): Promise<void> {
    entry.leases -= 1;
    if (entry.leases > 0 || this.entries.get(entry.projectId) !== entry) return;
    this.entries.delete(entry.projectId);
    await this.disposeEntry(entry);
  }

  private async disposeEntry(entry: AttachmentEntry): Promise<void> {
    let results: PromiseSettledResult<void>[] = [];
    try {
      results = await Promise.allSettled([this.cancelAttempt(entry), this.disposeProvider(entry)]);
    } finally {
      await entry.scope.dispose();
    }
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

export function createProjectAttachmentManager(
  options: CreateProjectAttachmentManagerOptions
): ProjectAttachmentManagerService {
  return new ProjectAttachmentManagerService(options);
}

function repositoryStatError(project: Project, failure: FsError | RuntimeResolveError) {
  if (isRuntimeResolveError(failure)) return failure;
  if (failure.type === 'not-found' || failure.type === 'not-a-directory') {
    return { type: 'repository-missing' as const, path: project.path };
  }
  if (
    failure.type === 'permission-denied' ||
    failure.type === 'invalid-path' ||
    failure.type === 'io'
  ) {
    return {
      type: 'repository-unavailable' as const,
      path: project.path,
      message: fsErrorMessage(failure),
    };
  }
  return {
    type: 'unexpected' as const,
    stage: 'repository-stat' as const,
    message: fsErrorMessage(failure),
  };
}

function attachmentProjectIdentity(project: Project): string {
  return [project.id, project.updatedAt, attachmentTargetIdentity(project)].join('\0');
}

function attachmentTargetIdentity(project: Project): string {
  return [
    formatHostRef(projectHostRef(project)),
    project.path,
    project.repositoryWorkspaceId ?? '',
  ].join('\0');
}

function isAutomaticallyEligibleFailure(failure: ProjectAttachmentError): boolean {
  return isRuntimeResolveError(failure) || failure.type === 'attachment-unavailable';
}
