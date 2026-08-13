import type { Result, Unsubscribe } from '@emdash/shared';
import type { Disposable, Scope } from '@emdash/shared/concurrency';
import type { Readable } from '@emdash/wire/state';
import type {
  AttachmentInvalidationCause,
  ProjectAttachmentError,
  ProjectAttachmentState,
  ProjectRecoveryRequestError,
} from '@core/features/projects/api/attachments';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import type { Project } from '@core/primitives/projects/api';

export type ProjectAttachmentManagerHooks = {
  projectOpened: (projectId: string, provider: ProjectProvider) => void | Promise<void>;
  projectClosed: (projectId: string) => void | Promise<void>;
};

export interface ProjectAttachmentManager extends Disposable {
  track(projectId: string, owner: Scope): Readable<ProjectAttachmentState>;
  recover(projectId: string): Promise<Result<void, ProjectRecoveryRequestError>>;
  requireAttached(projectId: string): Result<ProjectProvider, ProjectAttachmentError>;
  invalidate(projectId: string, cause: AttachmentInvalidationCause): Promise<void>;
  release(): Promise<void>;
  on<K extends keyof ProjectAttachmentManagerHooks>(
    name: K,
    handler: ProjectAttachmentManagerHooks[K]
  ): Unsubscribe;

  /** Temporary compatibility for callers that still drive renderer Project mounting. */
  openProject(project: Project | string): Promise<Result<ProjectProvider, ProjectAttachmentError>>;
  /** Temporary compatibility for existing deletion and repository-initialization callers. */
  closeProject(
    projectId: string,
    cause?: AttachmentInvalidationCause
  ): Promise<Result<void, ProjectAttachmentError>>;
  /** Temporary compatibility for node features pending requireAttached migration. */
  getProject(projectId: string): ProjectProvider | undefined;
}
