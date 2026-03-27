import { log } from '../lib/logger';

const SERVICE_NAME = 'emdash-account';
const SESSION_ACCOUNT = 'session-token';

export class AccountCredentialStore {
  async get(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(SERVICE_NAME, SESSION_ACCOUNT);
    } catch (error) {
      log.error('Failed to retrieve session token:', error);
      return null;
    }
  }

  async set(token: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.setPassword(SERVICE_NAME, SESSION_ACCOUNT, token);
    } catch (error) {
      log.error('Failed to store session token:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(SERVICE_NAME, SESSION_ACCOUNT);
    } catch (error) {
      log.error('Failed to clear session token:', error);
    }
  }
}

export const accountCredentialStore = new AccountCredentialStore();
