import { resolveSshConfig } from '../config/resolve-ssh-config';
import { findSshConfigHostByHostName, parseSshConfigFile } from '../config/sshConfigParser';
import type { SshCredentialService } from '../credentials/ssh-credential-service';
import { resolveSshConnectConfig, type SshConnectInput } from './resolve-ssh-connect-config';

type ConnectCredentials = Pick<SshCredentialService, 'getPassword' | 'getPassphrase'>;

export function createProductionSshConnectConfigResolver(credentials: ConnectCredentials) {
  return (input: SshConnectInput) =>
    resolveSshConnectConfig(input, {
      getPassword: (id, identity) => credentials.getPassword(id, identity),
      getPassphrase: (id, identity) => credentials.getPassphrase(id, identity),
      findSshConfigByHostName: async (hostname) => {
        const match = findSshConfigHostByHostName(await parseSshConfigFile(), hostname);
        return match ? resolveSshConfig(match.host) : undefined;
      },
    });
}

export function resolveProductionSshConnectConfig(
  input: SshConnectInput,
  credentials: ConnectCredentials
) {
  return createProductionSshConnectConfigResolver(credentials)(input);
}
