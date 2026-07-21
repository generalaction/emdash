import { resolve } from 'node:path';
import { app } from 'electron';
import type { SshServiceHandle } from '@core/manifests/node/ssh-service-handle';
import { SshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import {
  createR2WorkspaceServerArtifactSource,
  createRemoteFileWorkspaceServerArtifactSource,
  createWorkspaceServerService,
  type WorkspaceServerServiceHandle,
} from '@core/services/workspace-server/node';
import { createSshService } from '@main/bootstrap/core/ssh-service-factory';
import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../../core/app-scope';
import type { DatabaseBundle } from './database';

export type InfrastructureBundle = {
  readonly ssh: SshServiceHandle;
  readonly workspaceServer: WorkspaceServerServiceHandle;
};

export function bootInfrastructure(database: DatabaseBundle): InfrastructureBundle {
  const ssh = createSshService({
    scope: appScope,
    db: database.db,
    credentials: new SshCredentialService(encryptedAppSecretsStore),
    logger: log,
    telemetry: telemetryService,
  });
  const artifactUrlOverride = process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'];
  const artifacts =
    app.isPackaged || artifactUrlOverride
      ? createR2WorkspaceServerArtifactSource(artifactUrlOverride)
      : createRemoteFileWorkspaceServerArtifactSource({
          localDirectory: resolve(app.getAppPath(), '../workspace-server/dist-artifacts'),
          remoteDirectory:
            process.env['EMDASH_WORKSPACE_SERVER_REMOTE_ARTIFACTS_DIR'] ?? '/opt/emdash-artifacts',
        });
  const workspaceServer = createWorkspaceServerService({
    scope: appScope,
    ssh,
    artifacts,
    logger: log,
  });
  return { ssh, workspaceServer };
}
