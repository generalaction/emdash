import type { SshConfigHost } from '@shared/ssh';

export type AuthType = 'password' | 'key' | 'agent';

export function suggestedAuthTypeForSshConfigHost(_host: SshConfigHost): AuthType {
  return 'agent';
}
