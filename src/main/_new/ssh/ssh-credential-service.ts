import keytar from 'keytar';

const SERVICE_NAME = 'emdash-ssh';

export class SshCredentialService {
  async storePassword(connectionId: string, password: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, `${connectionId}:password`, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store password for connection ${connectionId}: ${message}`);
    }
  }

  async getPassword(connectionId: string): Promise<string | null> {
    try {
      return await keytar.getPassword(SERVICE_NAME, `${connectionId}:password`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve password for connection ${connectionId}: ${message}`);
    }
  }

  async deletePassword(connectionId: string): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, `${connectionId}:password`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete password for connection ${connectionId}: ${message}`);
    }
  }

  async hasPassword(connectionId: string): Promise<boolean> {
    try {
      const credential = await keytar.getPassword(SERVICE_NAME, `${connectionId}:password`);
      return credential !== null;
    } catch {
      return false;
    }
  }

  async storePassphrase(connectionId: string, passphrase: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, `${connectionId}:passphrase`, passphrase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async getPassphrase(connectionId: string): Promise<string | null> {
    try {
      return await keytar.getPassword(SERVICE_NAME, `${connectionId}:passphrase`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async deletePassphrase(connectionId: string): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, `${connectionId}:passphrase`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete passphrase for connection ${connectionId}: ${message}`);
    }
  }

  async hasPassphrase(connectionId: string): Promise<boolean> {
    try {
      const credential = await keytar.getPassword(SERVICE_NAME, `${connectionId}:passphrase`);
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
