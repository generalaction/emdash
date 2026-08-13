import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type { RemoteModel } from '@emdash/wire/state';
import { action, computed, makeObservable, observable } from 'mobx';
import type { projectsWireContract, ProjectAttachmentState } from '@core/features/projects/api';
import type { ProjectScopedStoreContext } from '@core/features/projects/contributions/project-stores';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { projectStoreContributions } from '@core/manifests/browser/project-scoped-stores';
import {
  createLayoutStorage,
  getMementoClient,
  type SubjectSpace,
} from '@core/primitives/mementos/browser';
import { projectHostRef } from '@core/primitives/projects/api';
import { projectSchema, type Project } from '@core/primitives/projects/api';
import {
  ScopedStoreHost,
  type ScopedStoreToken,
  type ScopedStoreValue,
} from '@core/primitives/scoped-stores/browser';
import { observeReadableInAction } from '@core/primitives/wire/browser/mobx-readable';
import type { hostsContract, HostAvailabilityState } from '@core/services/hosts/api';

export type ProjectContextError =
  | { type: 'invalid-project-record'; message: string }
  | {
      type: 'context-initialization-failed';
      stage: 'memento' | 'scoped-stores';
      message: string;
    };

export type ProjectContextLifecycle =
  | { kind: 'hydrating'; project: Project }
  | { kind: 'available'; context: ProjectContext }
  | {
      kind: 'desktop-context-failed';
      project: Project;
      error: ProjectContextError;
    };

export type ProjectHostAccessState =
  | { kind: 'offline' }
  | {
      kind: 'preparing';
      phase: Extract<HostAvailabilityState, { kind: 'preparing' }>['phase'];
    }
  | { kind: 'attaching' }
  | { kind: 'ready'; hostGeneration: number };

export interface ProjectHostAccess {
  readonly state: ProjectHostAccessState;
}

export function deriveProjectHostAccessState(
  availability: HostAvailabilityState | undefined,
  attachment: ProjectAttachmentState | undefined
): ProjectHostAccessState {
  if (!availability || availability.kind === 'unavailable' || availability.kind === 'suspended') {
    return { kind: 'offline' };
  }
  if (availability.kind === 'preparing') {
    return { kind: 'preparing', phase: availability.phase };
  }
  if (
    attachment?.kind === 'attached' &&
    attachment.establishedHostGeneration === availability.generation
  ) {
    return { kind: 'ready', hostGeneration: availability.generation };
  }
  return { kind: 'attaching' };
}

class HydratingProjectHostAccess implements ProjectHostAccess {
  availability: HostAvailabilityState | undefined;
  attachment: ProjectAttachmentState | undefined;

  constructor() {
    makeObservable(this, {
      attachment: observable.ref,
      availability: observable.ref,
      clear: action,
      state: computed,
    });
  }

  get state(): ProjectHostAccessState {
    return deriveProjectHostAccessState(this.availability, this.attachment);
  }

  clear(): void {
    this.availability = undefined;
    this.attachment = undefined;
  }
}

export class ProjectContext {
  readonly host: ProjectHostAccess;
  private readonly space: SubjectSpace<'project'>;
  private readonly stores: ScopedStoreHost<ProjectScopedStoreContext>;
  private readonly mutableHost: HydratingProjectHostAccess;
  private readonly scope: Scope;
  private hostAccessScope: Scope | undefined;

  private constructor(
    readonly project: Project,
    space: SubjectSpace<'project'>,
    stores: ScopedStoreHost<ProjectScopedStoreContext>,
    host: HydratingProjectHostAccess
  ) {
    this.space = space;
    this.stores = stores;
    this.host = host;
    this.mutableHost = host;
    this.scope = createScope({ label: `project-context:${project.id}` });
    this.scope.add(async () => await releaseSpace(this.space));
    this.scope.add(() => this.stores.dispose());
    this.scope.add(async () => await this.releaseHostAccess());
  }

  get<Token extends ScopedStoreToken<unknown>>(token: Token): ScopedStoreValue<Token> {
    return this.stores.get(token);
  }

  createLayoutStorage(
    definition: Parameters<typeof createLayoutStorage<'project'>>[1]
  ): ReturnType<typeof createLayoutStorage<'project'>> {
    return createLayoutStorage(this.space, definition);
  }

  static async hydrate(record: unknown): Promise<Result<ProjectContext, ProjectContextError>> {
    const parsed = projectSchema.safeParse(record);
    if (!parsed.success) {
      return err({
        type: 'invalid-project-record',
        message: parsed.error.message,
      });
    }

    const project = record as Project;
    const mementos = getMementoClient();
    let space: SubjectSpace<'project'>;
    try {
      space = mementos.subject(projectSubject({ projectId: project.id }));
    } catch (error) {
      return err(contextInitializationError('memento', error));
    }

    const host = new HydratingProjectHostAccess();
    let stores: ScopedStoreHost<ProjectScopedStoreContext>;
    try {
      stores = new ScopedStoreHost({ data: project, space, host }, projectStoreContributions);
    } catch (error) {
      await releaseSpace(space);
      return err(contextInitializationError('scoped-stores', error));
    }

    try {
      await Promise.all([
        space.ready.catch((error: unknown) => {
          throw new ContextHydrationStageError('memento', error);
        }),
        stores.ready().catch((error: unknown) => {
          throw new ContextHydrationStageError('scoped-stores', error);
        }),
      ]);
      stores.activate();
    } catch (error) {
      stores.dispose();
      await releaseSpace(space);
      const failure =
        error instanceof ContextHydrationStageError
          ? error
          : new ContextHydrationStageError('scoped-stores', error);
      return err(contextInitializationError(failure.stage, failure.cause));
    }

    return ok(new ProjectContext(project, space, stores, host));
  }

  trackHostAccess(
    availabilityModel: RemoteModel<typeof hostsContract.availability>,
    attachmentModel: RemoteModel<typeof projectsWireContract.attachments>
  ): void {
    if (this.scope.disposed) return;
    void this.releaseHostAccess();
    const accessScope = createScope({ label: `project-host-access:${this.project.id}` });
    const availabilityKey = { host: projectHostRef(this.project) };
    const attachmentKey = { projectId: this.project.id };
    const releaseAvailability = availabilityModel.retain(availabilityKey);
    let releaseAttachment: (() => void) | undefined;
    try {
      releaseAttachment = attachmentModel.retain(attachmentKey);
      const availability = availabilityModel(availabilityKey).states.state;
      const attachment = attachmentModel(attachmentKey).states.state;
      observeReadableInAction(
        availability,
        (snapshot) => {
          this.mutableHost.availability = snapshot.value;
        },
        { scope: accessScope, immediate: true }
      );
      observeReadableInAction(
        attachment,
        (snapshot) => {
          this.mutableHost.attachment = snapshot.value;
        },
        { scope: accessScope, immediate: true }
      );
      accessScope.add(releaseAvailability);
      accessScope.add(releaseAttachment);
      this.hostAccessScope = accessScope;
    } catch (error) {
      releaseAttachment?.();
      releaseAvailability();
      void accessScope.dispose();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
  }

  private async releaseHostAccess(): Promise<void> {
    const accessScope = this.hostAccessScope;
    this.hostAccessScope = undefined;
    this.mutableHost.clear();
    await accessScope?.dispose();
  }
}

class ContextHydrationStageError {
  constructor(
    readonly stage: 'memento' | 'scoped-stores',
    readonly cause: unknown
  ) {}
}

function contextInitializationError(
  stage: 'memento' | 'scoped-stores',
  error: unknown
): ProjectContextError {
  return {
    type: 'context-initialization-failed',
    stage,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function releaseSpace(space: SubjectSpace<'project'>): Promise<void> {
  try {
    await space.release();
  } catch (error) {
    getMementoClient().reportError(error);
  }
}
