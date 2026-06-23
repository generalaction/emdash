import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
    getSelectedStorageBackend: () => 'os_crypt',
  },
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/db/schema', () => ({
  appSecrets: {
    key: 'key',
    secret: 'secret',
  },
}));

import { EncryptedAppSecretsStore } from './encrypted-app-secrets-store';

describe('EncryptedAppSecretsStore', () => {
  it('explains how to fix Linux basic_text secure storage fallback', async () => {
    const safeStorageApi = {
      isEncryptionAvailable: () => true,
      encryptString: vi.fn((value: string) => Buffer.from(value)),
      decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
      getSelectedStorageBackend: () => 'basic_text',
    };
    const store = new EncryptedAppSecretsStore({} as never, safeStorageApi as never, 'linux');

    await expect(store.setSecret('token', 'secret')).rejects.toThrow(
      '--password-store=gnome-libsecret'
    );
    expect(safeStorageApi.encryptString).not.toHaveBeenCalled();
  });
});
