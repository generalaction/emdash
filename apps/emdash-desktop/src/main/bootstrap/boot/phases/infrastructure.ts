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

export async function bootInfrastructure(database: DatabaseBundle): Promise<InfrastructureBundle> {
  const ssh = createSshService({
    scope: appScope,
    db: database.db,
    credentials: new SshCredentialService(encryptedAppSecretsStore),
    logger: log,
    telemetry: telemetryService,
  });
  const remoteMachineSettings = await database.appSettings.get('remoteMachine');
  const remoteMachine = createRemoteMachineService({
    scope: appScope,
    ssh: { manager: ssh.manager, connect: ssh.ssh },
    machineEvents: ssh.machines,
    installBaseUrl: remoteMachineSettings.installBaseUrl,
    installCommand: remoteMachineSettings.installCommand ?? undefined,
    logger: log,
  });
  return { ssh, remoteMachine };
}
