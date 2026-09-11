import { secret, type Secret } from '@emdash/shared';
import { sshCredentialReuse } from '@core/primitives/ssh/api/credential-reuse';
import type { SshConfig } from '@core/primitives/ssh/api/ssh';
import type { SshCredentialService } from './ssh-credential-service';

/** Shared by transient tests and saves. Retained secrets never cross the renderer boundary. */
export async function resolveCredentialDraft(
  draft: Omit<SshConfig, 'id'> & { password?: string; passphrase?: string },
  previous: SshConfig | undefined,
  credentials: Pick<SshCredentialService, 'getPassword' | 'getPassphrase'>
): Promise<{ password: Secret<string> | null; passphrase: Secret<string> | null }> {
  const reuse = sshCredentialReuse(draft, previous);
  let password: Secret<string> | null = null;
  let passphrase: Secret<string> | null = null;
  if (draft.authType === 'password') {
    password = draft.password
      ? secret(draft.password, 'ssh-password')
      : reuse.password && previous
        ? await credentials.getPassword(previous.id)
        : null;
    if (!password) throw new Error('Enter a password for this connection.');
  } else if (draft.authType === 'key') {
    passphrase = draft.passphrase
      ? secret(draft.passphrase, 'ssh-passphrase')
      : reuse.passphrase && previous
        ? await credentials.getPassphrase(previous.id)
        : null;
  }
  return { password, passphrase };
}
