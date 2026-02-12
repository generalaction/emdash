import keytar from 'keytar';

const SERVICE_NAME = 'emdash-ssh';

/**
 * Service for managing SSH credentials securely.
 * Uses system keychain for password and passphrase storage via keytar.
 */
export class SshCredentialService {
  /**
   * Store password for a connection
   * @param connectionId - Unique identifier for the connection
   * @param password - Password to store
   * @throws Error if storage fails
   */
  async storePassword(connectionId: string, password: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, `${connectionId}:password`, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store password for connection ${connectionId}: ${message}`);
    }
  }

  /**
   * Retrieve password for a connection
   * @param connectionId - Unique identifier for the connection
   * @returns The stored password or null if not found
   * @throws Error if retrieval fails
   */
  async getPassword(connectionId: string): Promise<string | null> {
    try {
      const credential = await keytar.getPassword(SERVICE_NAME, `${connectionId}:password`);
      return credential;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve password for connection ${connectionId}: ${message}`);
    }
  }

  /**
   * Delete stored password
   * @param connectionId - Unique identifier for the connection
   * @throws Error if deletion fails
   */
  async deletePassword(connectionId: string): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, `${connectionId}:password`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete password for connection ${connectionId}: ${message}`);
    }
  }

  /**
   * Checks if a password exists in the keychain.
   * @param connectionId - Unique identifier for the connection
   * @returns True if password exists
   */
  async hasPassword(connectionId: string): Promise<boolean> {
    try {
      const credential = await keytar.getPassword(SERVICE_NAME, `${connectionId}:password`);
      return credential !== null;
    } catch {
      return false;
    }
  }

  /**
   * Store passphrase for a private key
   * @param connectionId - Unique identifier for the connection
   * @param passphrase - Passphrase to store
   * @throws Error if storage fails
   */
  async storePassphrase(connectionId: string, passphrase: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, `${connectionId}:passphrase`, passphrase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store passphrase for connection ${connectionId}: ${message}`);
    }
  }

  /**
   * Retrieve passphrase for a private key
   * @param connectionId - Unique identifier for the connection
   * @returns The stored passphrase or null if not found
   * @throws Error if retrieval fails
   */
  async getPassphrase(connectionId: string): Promise<string | null> {
    try {
      const credential = await keytar.getPassword(SERVICE_NAME, `${connectionId}:passphrase`);
      return credential;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to retrieve passphrase for connection ${connectionId}: ${message}`);
    }
  }

  /**
   * Delete stored passphrase
   * @param connectionId - Unique identifier for the connection
   * @throws Error if deletion fails
   */
  async deletePassphrase(connectionId: string): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, `${connectionId}:passphrase`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete passphrase for connection ${connectionId}: ${message}`);
    }
  }

  /**
   * Checks if a passphrase exists in the keychain.
   * @param connectionId - Unique identifier for the connection
   * @returns True if passphrase exists
   */
  async hasPassphrase(connectionId: string): Promise<boolean> {
    try {
      const credential = await keytar.getPassword(SERVICE_NAME, `${connectionId}:passphrase`);
      return credential !== null;
    } catch {
      return false;
    }
  }

  /**
   * Store both password and passphrase in one call
   * @param connectionId - Unique identifier for the connection
   * @param credentials - Object containing optional password and passphrase
   * @throws Error if any storage operation fails
   */
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

  /**
   * Delete all credentials for a connection
   * @param connectionId - Unique identifier for the connection
   * @throws Error if any deletion operation fails
   */
  async deleteAllCredentials(connectionId: string): Promise<void> {
    await Promise.all([
      this.deletePassword(connectionId).catch(() => {
        // Ignore errors for individual deletions
      }),
      this.deletePassphrase(connectionId).catch(() => {
        // Ignore errors for individual deletions
      }),
    ]);
  }
}
