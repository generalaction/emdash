import type { SshConfig } from './ssh';

type CredentialIdentity = Pick<
  SshConfig,
  'host' | 'port' | 'username' | 'sshConfigAlias' | 'authType' | 'privateKeyPath' | 'proxyJump'
>;

/**
 * Form-level eligibility, not proof that a secret is reusable. The main process must
 * also verify the resolved destination and the stored credential's effective-key binding.
 */
export function sshCredentialReuse(next: CredentialIdentity, previous?: CredentialIdentity) {
  const sameConnection =
    !!previous &&
    next.host === previous.host &&
    next.port === previous.port &&
    next.username === previous.username &&
    (next.sshConfigAlias || '') === (previous.sshConfigAlias || '') &&
    (!!next.sshConfigAlias || (next.proxyJump || '') === (previous.proxyJump || '')) &&
    next.authType === previous.authType;

  return {
    password: sameConnection && next.authType === 'password',
    passphrase:
      sameConnection &&
      next.authType === 'key' &&
      (next.privateKeyPath?.trim() || '') === (previous?.privateKeyPath?.trim() || ''),
  };
}
