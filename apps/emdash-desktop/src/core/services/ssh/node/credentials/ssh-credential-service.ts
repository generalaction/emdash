import type { Secret } from '@emdash/shared';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import { bindCredential, readBoundCredential, sshCredentialKeys } from './credential-record';

/**
 * Stores and retrieves SSH passwords and passphrases as `Secret`-typed values.
 * Plaintext never surfaces here: values arrive wrapped, pass through the
 * Secret-typed store, and are disclosed only at the ssh2 connect-config
 * assembly (`connect/ssh-connect-auth.ts`).
 */
export class SshCredentialService {
  constructor(private readonly secrets: SecretStore) {}

  private passwordSecretKey(connectionId: string): string {
    return sshCredentialKeys(connectionId).password;
  }

  private passphraseSecretKey(connectionId: string): string {
    return sshCredentialKeys(connectionId).passphrase;
  }

  async storePassword(
    connectionId: string,
    password: Secret<string>,
    identity?: string
  ): Promise<void> {
    try {
      const keys = sshCredentialKeys(connectionId);
      await this.secrets.setSecret(
        identity ? keys.boundPassword : keys.password,
        identity ? bindCredential(password, identity) : password
      );
      await this.secrets.deleteSecret(identity ? keys.password : keys.boundPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store password for connection ${connectionId}: ${message}`);
    }
  }

  async getPassword(connectionId: string, identity?: string): Promise<Secret<string> | null> {
    try {
      if (identity) {
        const bound = await this.secrets.getSecret(sshCredentialKeys(connectionId).boundPassword);
        if (bound) return readBoundCredential(bound, identity);
        // Legacy passwords are eligible only after the caller verifies the saved destination.
      }
      return await this.secrets.getSecret(this.passwordSecretKey(connectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve password for connection ${connectionId}: ${message}`);
    }
  }

  async deletePassword(connectionId: string): Promise<void> {
    try {
      await this.secrets.deleteSecret(this.passwordSecretKey(connectionId));
      await this.secrets.deleteSecret(sshCredentialKeys(connectionId).boundPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete password for connection ${connectionId}: ${message}`);
    }
  }

  async hasPassword(connectionId: string): Promise<boolean> {
    try {
      const credential =
        (await this.secrets.getSecret(sshCredentialKeys(connectionId).boundPassword)) ??
        (await this.secrets.getSecret(this.passwordSecretKey(connectionId)));
      return credential !== null;
    } catch {
      return false;
    }
  }

  async storePassphrase(
    connectionId: string,
    passphrase: Secret<string>,
    identity?: string
  ): Promise<void> {
    try {
      const keys = sshCredentialKeys(connectionId);
      await this.secrets.setSecret(
        identity ? keys.boundPassphrase : keys.passphrase,
        identity ? bindCredential(passphrase, identity) : passphrase
      );
      await this.secrets.deleteSecret(identity ? keys.passphrase : keys.boundPassphrase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async getPassphrase(connectionId: string, identity?: string): Promise<Secret<string> | null> {
    try {
      if (identity) {
        const bound = await this.secrets.getSecret(sshCredentialKeys(connectionId).boundPassphrase);
        if (bound) return readBoundCredential(bound, identity);
        if (await this.secrets.getSecret(this.passphraseSecretKey(connectionId))) {
          throw new Error(
            'Re-enter your SSH key passphrase once to verify it for this key. Your saved passphrase has not been changed.'
          );
        }
        return null;
      }
      return await this.secrets.getSecret(this.passphraseSecretKey(connectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async deletePassphrase(connectionId: string): Promise<void> {
    try {
      await this.secrets.deleteSecret(this.passphraseSecretKey(connectionId));
      await this.secrets.deleteSecret(sshCredentialKeys(connectionId).boundPassphrase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async hasPassphrase(connectionId: string): Promise<boolean> {
    try {
      const credential =
        (await this.secrets.getSecret(sshCredentialKeys(connectionId).boundPassphrase)) ??
        (await this.secrets.getSecret(this.passphraseSecretKey(connectionId)));
      return credential !== null;
    } catch {
      return false;
    }
  }

  async storeCredentials(
    connectionId: string,
    credentials: { password?: Secret<string>; passphrase?: Secret<string> }
  ): Promise<void> {
    const operations: Promise<void>[] = [];
    if (credentials.password) {
      operations.push(this.storePassword(connectionId, credentials.password));
    }
    if (credentials.passphrase) {
      operations.push(this.storePassphrase(connectionId, credentials.passphrase));
    }
    if (operations.length > 0) {
      await Promise.all(operations);
    }
  }

  async deleteAllCredentials(connectionId: string): Promise<void> {
    await Promise.all([
      this.deletePassword(connectionId).catch(() => {}),
      this.deletePassphrase(connectionId).catch(() => {}),
    ]);
  }
}
