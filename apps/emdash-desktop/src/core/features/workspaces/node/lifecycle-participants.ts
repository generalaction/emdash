import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { registerFileSearchRoot } from '@main/core/file-search/runtime-client';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { log } from '@main/lib/logger';
import type { WorkspaceIdentity } from './workspace-identity-service';

export type WorkspaceLifecycleContext = Readonly<{
  identity: WorkspaceIdentity;
}>;

export type WorkspaceLifecycleParticipant = Readonly<{
  id: string;
  activate?(context: WorkspaceLifecycleContext): void | Promise<void>;
  deactivate?(context: WorkspaceLifecycleContext): void | Promise<void>;
}>;

export const workspaceLifecycleParticipants: readonly WorkspaceLifecycleParticipant[] = [
  {
    id: 'file-search',
    activate: ({ identity }) =>
      registerFileSearchRoot(
        hostFileRefFromNativePath(identity.path, sshConnectionIdOf(identity.host)).path
      ),
  },
  {
    id: 'preview-servers',
    deactivate: ({ identity }) =>
      previewServerService.stopForWorkspace(identity.projectId, identity.workspaceId),
  },
];

export async function activateWorkspaceParticipants(identity: WorkspaceIdentity): Promise<void> {
  await runParticipants('activate', identity);
}

export async function deactivateWorkspaceParticipants(identity: WorkspaceIdentity): Promise<void> {
  await runParticipants('deactivate', identity);
}

async function runParticipants(
  phase: 'activate' | 'deactivate',
  identity: WorkspaceIdentity
): Promise<void> {
  const results = await Promise.allSettled(
    workspaceLifecycleParticipants.map((participant) =>
      Promise.resolve(participant[phase]?.({ identity }))
    )
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    log.warn('Workspace lifecycle participant failed', {
      participant: workspaceLifecycleParticipants[index]?.id,
      phase,
      workspaceId: identity.workspaceId,
      error: result.reason,
    });
  });
}
