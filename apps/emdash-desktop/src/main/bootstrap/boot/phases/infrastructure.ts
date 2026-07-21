import type { SshServiceHandle } from '@core/manifests/node/ssh-service-handle';
import {
  createRemoteMachineService,
  type RemoteMachineService,
} from '@core/services/remote-machine/node';
import { SshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import { createSshService } from '@main/bootstrap/core/ssh-service-factory';
import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../../core/app-scope';
import type { DatabaseBundle } from './database';

export type InfrastructureBundle = {
  readonly ssh: SshServiceHandle;
  readonly remoteMachine: RemoteMachineService;
};

export function bootInfrastructure(database: DatabaseBundle): InfrastructureBundle {
  const ssh = createSshService({
    scope: appScope,
    db: database.db,
    credentials: new SshCredentialService(encryptedAppSecretsStore),
    logger: log,
    telemetry: telemetryService,
  });
  const remoteMachine = createRemoteMachineService({
    scope: appScope,
    ssh: { manager: ssh.manager, connect: ssh.ssh },
    machineEvents: ssh.machines,
    logger: log,
  });
  return { ssh, remoteMachine };
}
