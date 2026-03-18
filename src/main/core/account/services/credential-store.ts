import keytar from 'keytar';
import { log } from '@main/lib/logger';

const SERVICE_NAME = 'emdash-account';
const SESSION_ACCOUNT = 'session-token';

export class AccountCredentialStore {
  async get(): Promise<string | null> {
    try {
      return await keytar.getPassword(SERVICE_NAME, SESSION_ACCOUNT);
    } catch (error) {
      log.error('Failed to retrieve session token:', error);
      return null;
    }
  }

  async set(token: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, SESSION_ACCOUNT, token);
    } catch (error) {
      log.error('Failed to store session token:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, SESSION_ACCOUNT);
    } catch (error) {
      log.error('Failed to clear session token:', error);
    }
  }
}

export const accountCredentialStore = new AccountCredentialStore();
