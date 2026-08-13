import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type { RemoteModel, RemoteState } from '@emdash/wire/state';
import { makeObservable, observable } from 'mobx';
import type { projectsWireContract, ProjectAttachmentState } from '@core/features/projects/api';
import type { ProjectScopedStoreContext } from '@core/features/projects/contributions/project-stores';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { projectStoreContributions } from '@core/manifests/browser/project-scoped-stores';
import { getMementoClient, type SubjectSpace } from '@core/primitives/mementos/browser';
import { projectSchema, type Project } from '@core/primitives/projects/api';
import {
  ScopedStoreHost,
  type ScopedStoreToken,
  type ScopedStoreValue,
} from '@core/primitives/scoped-stores/browser';

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

export interface ProjectHostAccess {
  readonly attachment: RemoteState<ProjectAttachmentState> | undefined;
}

class HydratingProjectHostAccess implements ProjectHostAccess {
  attachment: RemoteState<ProjectAttachmentState> | undefined;

  constructor() {
    makeObservable(this, { attachment: observable.ref });
  }
}

export class ProjectContext {
  readonly host: ProjectHostAccess;
  private readonly space: SubjectSpace<'project'>;
  private readonly stores: ScopedStoreHost<ProjectScopedStoreContext>;
  private readonly mutableHost: HydratingProjectHostAccess;
  private readonly scope: Scope;
  private releaseAttachment: (() => void) | undefined;

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
    this.scope.add(() => {
      const release = this.releaseAttachment;
      this.releaseAttachment = undefined;
      this.mutableHost.attachment = undefined;
      release?.();
    });
  }

  get<Token extends ScopedStoreToken<unknown>>(token: Token): ScopedStoreValue<Token> {
    return this.stores.get(token);
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

  trackAttachment(model: RemoteModel<typeof projectsWireContract.attachments>): void {
    if (this.scope.disposed) return;
    const releasePrevious = this.releaseAttachment;
    this.releaseAttachment = undefined;
    this.mutableHost.attachment = undefined;
    releasePrevious?.();
    const key = { projectId: this.project.id };
    const release = model.retain(key);
    try {
      this.mutableHost.attachment = model(key).states.state;
      this.releaseAttachment = release;
    } catch (error) {
      release();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
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
