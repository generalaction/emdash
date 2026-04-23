import { eq } from 'drizzle-orm';
import { safeStorage } from 'electron';
import type { AppDb } from '@main/db/client';
import { appSecrets } from '@main/db/schema';

export class EncryptedAppSecretsStore {
  constructor(
    private readonly database?: AppDb,
    private readonly safeStorageApi = safeStorage,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  private async getDatabase(): Promise<AppDb> {
    if (this.database) {
      return this.database;
    }

    return (await import('@main/db/client')).db;
  }

  async getSecret(key: string): Promise<string | null> {
    const database = await this.getDatabase();
    const rows = await database
      .select({ secret: appSecrets.secret })
      .from(appSecrets)
      .where(eq(appSecrets.key, key))
      .limit(1);

    const secret = rows[0]?.secret;
    if (!secret) {
      return null;
    }

    this.assertSecureStorageAvailable();
    return this.safeStorageApi.decryptString(Buffer.from(secret, 'base64'));
  }

  async setSecret(key: string, secret: string): Promise<void> {
    this.assertSecureStorageAvailable();
    const encryptedSecret = this.safeStorageApi.encryptString(secret).toString('base64');

    await this.setEncryptedSecret(key, encryptedSecret);
  }

  async setEncryptedSecret(key: string, encryptedSecret: string): Promise<void> {
    const database = await this.getDatabase();
    await database
      .insert(appSecrets)
      .values({
        key: key,
        secret: encryptedSecret,
      })
      .onConflictDoUpdate({ target: appSecrets.key, set: { secret: encryptedSecret } })
      .execute();
  }

  async deleteSecret(key: string): Promise<void> {
    const database = await this.getDatabase();
    await database.delete(appSecrets).where(eq(appSecrets.key, key));
  }

  private assertSecureStorageAvailable(): void {
    if (!this.safeStorageApi.isEncryptionAvailable()) {
      throw new Error('Secure secret storage is unavailable on this system.');
    }

    if (this.platform !== 'linux') {
      return;
    }

    const backend = this.safeStorageApi.getSelectedStorageBackend?.();
    if (backend === 'basic_text') {
      throw new Error(
        'Secure secret storage is unavailable: Linux safeStorage backend is basic_text.'
      );
    }
  }
}

export const encryptedAppSecretsStore = new EncryptedAppSecretsStore();
