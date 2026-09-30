import type { Secret } from '@emdash/shared';
import type { ResolvedCredentialDraft } from './resolve-credential-draft';

export function sshCredentialKeys(connectionId: string) {
  return {
    password: `ssh:${connectionId}:password`,
    passphrase: `ssh:${connectionId}:passphrase`,
    boundPassword: `ssh:${connectionId}:password:v1`,
    boundPassphrase: `ssh:${connectionId}:passphrase:v1`,
  };
}

export function bindCredential(value: Secret<string>, identity: string): Secret<string> {
  return value.map((value) => JSON.stringify({ version: 1, identity, value }));
}

/** The binding and value are read together; a concurrent save cannot mix generations. */
export function readBoundCredential(
  record: Secret<string>,
  identity: string
): Secret<string> | null {
  let matches = false;
  const value = record.map((raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Invalid stored SSH credential');
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('identity' in parsed) ||
      typeof parsed.identity !== 'string' ||
      !('value' in parsed) ||
      typeof parsed.value !== 'string'
    ) {
      throw new Error('Invalid stored SSH credential');
    }
    matches = parsed.identity === identity;
    return parsed.value;
  });
  return matches ? value : null;
}

export function sshCredentialChanges(connectionId: string, credentials: ResolvedCredentialDraft) {
  const keys = sshCredentialKeys(connectionId);
  return new Map<string, Secret<string> | null>([
    [keys.password, null],
    [keys.passphrase, null],
    [
      keys.boundPassword,
      credentials.password ? bindCredential(credentials.password, credentials.identity) : null,
    ],
    [
      keys.boundPassphrase,
      credentials.passphrase ? bindCredential(credentials.passphrase, credentials.identity) : null,
    ],
  ]);
}
