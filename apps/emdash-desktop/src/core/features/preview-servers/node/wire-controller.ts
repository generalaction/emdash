import { err, ok } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/rpc';
import { previewServerService } from '@core/features/preview-servers/api/node/preview-server-service-instance';
import type { PreviewServerService } from '@core/features/preview-servers/node/preview-server-service';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type { PreviewServerUnavailableError } from '@core/primitives/preview-servers/api';
import { previewServersContract } from '../api';
import { previewServerEvents } from './event-host';

type PreviewServerControllerService = Pick<
  PreviewServerService,
  'forwardManual' | 'getServer' | 'listForWorkspace' | 'restart' | 'stop'
>;

export function createPreviewServersWireController({
  projects,
  service = previewServerService,
}: {
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  service?: PreviewServerControllerService;
}): Controller {
  const observedWorkspaces = new Set<string>();
  const requireProject = async (projectId: string) => {
    const attached = projects.requireAttached(projectId);
    return attached.success ? ok<void>() : err(projectUnavailable(projectId, attached.error));
  };

  return createController(previewServersContract, {
    listForWorkspace: async (input) => {
      const key = `${input.projectId}:${input.workspaceId}`;
      const attached = await requireProject(input.projectId);
      if (!attached.success && !observedWorkspaces.has(key)) return err(attached.error);
      const servers = service.listForWorkspace(input);
      if (attached.success) observedWorkspaces.add(key);
      return ok(servers);
    },
    forwardManual: async (input) => {
      const attached = await requireProject(input.projectId);
      if (!attached.success) return err(attached.error);
      return service.forwardManual(input);
    },
    restart: async ({ id }) => {
      const server = service.getServer(id);
      if (server) {
        const attached = await requireProject(server.projectId);
        if (!attached.success) return err(attached.error);
      }
      await service.restart(id);
      return ok<void>();
    },
    stop: async ({ id }) => {
      const server = service.getServer(id);
      if (server) {
        const attached = await requireProject(server.projectId);
        if (!attached.success) return err(attached.error);
      }
      await service.stop(id);
      return ok<void>();
    },
    events: previewServerEvents,
  });
}

function projectUnavailable(
  projectId: string,
  error: { type: string; message?: string }
): PreviewServerUnavailableError {
  return {
    type: 'project-unavailable',
    projectId,
    reason: error.type,
    message: error.message ?? 'Project runtime is unavailable.',
  };
}
