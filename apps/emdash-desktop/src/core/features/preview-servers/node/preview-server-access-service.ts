import { err, ok, type Result } from '@emdash/shared';
import type { ProjectAttachmentError } from '@core/features/projects/api/attachments';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type {
  ManualPreviewServerRequest,
  ManualPreviewServerResult,
  PreviewServer,
  PreviewServerUnavailableError,
} from '@core/primitives/preview-servers/api';
import type { PreviewServerService } from './preview-server-service';

export type PreviewServerAccessBackend = Pick<
  PreviewServerService,
  'forwardManual' | 'getServer' | 'listForWorkspace' | 'restart' | 'stop'
>;

export interface PreviewServerAccessOperations {
  listForWorkspace(input: {
    projectId: string;
    workspaceId: string;
  }): Promise<Result<PreviewServer[], PreviewServerUnavailableError>>;
  forwardManual(input: ManualPreviewServerRequest): Promise<ManualPreviewServerResult>;
  restart(input: { id: string }): Promise<Result<void, PreviewServerUnavailableError>>;
  stop(input: { id: string }): Promise<Result<void, PreviewServerUnavailableError>>;
}

export interface PreviewServerAccessServiceDependencies {
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  previewServers: PreviewServerAccessBackend;
}

export class PreviewServerAccessService implements PreviewServerAccessOperations {
  private readonly observedWorkspaces = new Map<string, Set<string>>();

  constructor(private readonly dependencies: PreviewServerAccessServiceDependencies) {}

  async listForWorkspace(input: {
    projectId: string;
    workspaceId: string;
  }): Promise<Result<PreviewServer[], PreviewServerUnavailableError>> {
    const attached = this.requireProject(input.projectId);
    const observed = this.observedWorkspaces.get(input.projectId)?.has(input.workspaceId) ?? false;
    if (!attached.success && !observed) return attached;

    const servers = this.dependencies.previewServers.listForWorkspace(input);
    if (attached.success) this.observeWorkspace(input.projectId, input.workspaceId);
    return ok(servers);
  }

  forgetProject(projectId: string): void {
    this.observedWorkspaces.delete(projectId);
  }

  async forwardManual(input: ManualPreviewServerRequest): Promise<ManualPreviewServerResult> {
    const attached = this.requireProject(input.projectId);
    if (!attached.success) return attached;
    return this.dependencies.previewServers.forwardManual(input);
  }

  async restart({ id }: { id: string }): Promise<Result<void, PreviewServerUnavailableError>> {
    const attached = this.requireServerProject(id);
    if (!attached.success) return attached;
    await this.dependencies.previewServers.restart(id);
    return ok<void>();
  }

  async stop({ id }: { id: string }): Promise<Result<void, PreviewServerUnavailableError>> {
    const attached = this.requireServerProject(id);
    if (!attached.success) return attached;
    await this.dependencies.previewServers.stop(id);
    return ok<void>();
  }

  private requireServerProject(id: string): Result<void, PreviewServerUnavailableError> {
    const server = this.dependencies.previewServers.getServer(id);
    return server ? this.requireProject(server.projectId) : ok<void>();
  }

  private requireProject(projectId: string): Result<void, PreviewServerUnavailableError> {
    const attached = this.dependencies.projects.requireAttached(projectId);
    return attached.success ? ok<void>() : err(projectUnavailable(projectId, attached.error));
  }

  private observeWorkspace(projectId: string, workspaceId: string): void {
    let workspaces = this.observedWorkspaces.get(projectId);
    if (!workspaces) {
      workspaces = new Set();
      this.observedWorkspaces.set(projectId, workspaces);
    }
    workspaces.add(workspaceId);
  }
}

function projectUnavailable(
  projectId: string,
  error: ProjectAttachmentError
): PreviewServerUnavailableError {
  return {
    type: 'project-unavailable',
    projectId,
    reason: error.type,
    message:
      'message' in error && typeof error.message === 'string'
        ? error.message
        : 'Project runtime is unavailable.',
  };
}
