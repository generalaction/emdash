import type { SshConfigHost } from '@shared/core/ssh/ssh';

export type AuthType = 'password' | 'key' | 'agent';

export function suggestedAuthTypeForSshConfigHost(host: SshConfigHost): AuthType {
  if (host.identityAgent) return 'agent';
  if (host.identityFile) return 'key';
  return 'agent';
}
