import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';

export class SshCredentialService {
  private passwordSecretKey(connectionId: string): string {
    return `ssh:${connectionId}:password`;
  }

  private passphraseSecretKey(connectionId: string): string {
    return `ssh:${connectionId}:passphrase`;
  }

  async storePassword(connectionId: string, password: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(this.passwordSecretKey(connectionId), password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store password for connection ${connectionId}: ${message}`);
    }
  }

  async getPassword(connectionId: string): Promise<string | null> {
    try {
      return await encryptedAppSecretsStore.getSecret(this.passwordSecretKey(connectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve password for connection ${connectionId}: ${message}`);
    }
  }

  async deletePassword(connectionId: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.deleteSecret(this.passwordSecretKey(connectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete password for connection ${connectionId}: ${message}`);
    }
  }

  async hasPassword(connectionId: string): Promise<boolean> {
    try {
      const credential = await encryptedAppSecretsStore.getSecret(
        this.passwordSecretKey(connectionId)
      );
      return credential !== null;
    } catch {
      return false;
    }
  }

  async storePassphrase(connectionId: string, passphrase: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(this.passphraseSecretKey(connectionId), passphrase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async getPassphrase(connectionId: string): Promise<string | null> {
    try {
      return await encryptedAppSecretsStore.getSecret(this.passphraseSecretKey(connectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async deletePassphrase(connectionId: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.deleteSecret(this.passphraseSecretKey(connectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async hasPassphrase(connectionId: string): Promise<boolean> {
    try {
      const credential = await encryptedAppSecretsStore.getSecret(
        this.passphraseSecretKey(connectionId)
      );
      return credential !== null;
    } catch {
      return false;
    }
  }

  async storeCredentials(
    connectionId: string,
    credentials: { password?: string; passphrase?: string }
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

export const sshCredentialService = new SshCredentialService();
