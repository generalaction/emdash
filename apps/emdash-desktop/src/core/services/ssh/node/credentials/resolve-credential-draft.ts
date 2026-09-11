import { secret, type Secret } from '@emdash/shared';
import { sshCredentialReuse } from '@core/primitives/ssh/api/credential-reuse';
import type { SshConfig } from '@core/primitives/ssh/api/ssh';
import { sshCredentialIdentity } from './credential-identity';

export interface CredentialLookup {
  getPassword(connectionId: string, identity: string): Promise<Secret<string> | null>;
  getPassphrase(connectionId: string, identity: string): Promise<Secret<string> | null>;
}

export interface ResolvedCredentialDraft {
  password: Secret<string> | null;
  passphrase: Secret<string> | null;
  identity: string;
}

/** Shared by transient tests and saves. Retained secrets never cross the renderer boundary. */
export async function resolveCredentialDraft(
  draft: Omit<SshConfig, 'id'> & { password?: string; passphrase?: string },
  previous: SshConfig | undefined,
  credentials: CredentialLookup,
  keyFingerprint?: string
): Promise<ResolvedCredentialDraft> {
  const reuse = sshCredentialReuse(draft, previous);
  const identity = sshCredentialIdentity(draft, keyFingerprint);
  let password: Secret<string> | null = null;
  let passphrase: Secret<string> | null = null;
  if (draft.authType === 'password') {
    password = draft.password
      ? secret(draft.password, 'ssh-password')
      : reuse.password && previous
        ? await credentials.getPassword(previous.id, identity)
        : null;
    if (!password) throw new Error('Enter a password for this connection.');
  } else if (draft.authType === 'key') {
    passphrase = draft.passphrase
      ? secret(draft.passphrase, 'ssh-passphrase')
      : reuse.passphrase && previous
        ? await credentials.getPassphrase(previous.id, identity)
        : null;
  }
  return { password, passphrase, identity };
}
