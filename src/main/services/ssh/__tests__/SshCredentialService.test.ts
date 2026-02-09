import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { SshCredentialService } from '../SshCredentialService';

// Mock keytar with hoisting-safe pattern
const mockSetPassword = vi.fn().mockResolvedValue(undefined);
const mockGetPassword = vi.fn().mockResolvedValue(null);
const mockDeletePassword = vi.fn().mockResolvedValue(undefined);

vi.mock('keytar', () => {
  return {
    setPassword: (...args: any[]) => mockSetPassword(...args),
    getPassword: (...args: any[]) => mockGetPassword(...args),
    deletePassword: (...args: any[]) => mockDeletePassword(...args),
    default: {
      setPassword: (...args: any[]) => mockSetPassword(...args),
      getPassword: (...args: any[]) => mockGetPassword(...args),
      deletePassword: (...args: any[]) => mockDeletePassword(...args),
    },
  };
});

describe('SshCredentialService', () => {
  let service: SshCredentialService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock implementations
    mockSetPassword.mockResolvedValue(undefined);
    mockGetPassword.mockResolvedValue(null);
    mockDeletePassword.mockResolvedValue(undefined);
    service = new SshCredentialService();
  });

  describe('password operations', () => {
    it('should store password in keychain', async () => {
      await service.storePassword('conn-1', 'secretpassword');

      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'conn-1:password',
        'secretpassword'
      );
    });

    it('should retrieve password from keychain', async () => {
      mockGetPassword.mockResolvedValue('secretpassword');

      const result = await service.getPassword('conn-1');

      expect(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
      expect(result).toBe('secretpassword');
    });

    it('should return null when password not found', async () => {
      mockGetPassword.mockResolvedValue(null);

      const result = await service.getPassword('conn-1');

      expect(result).toBeNull();
    });

    it('should delete password from keychain', async () => {
      await service.deletePassword('conn-1');

      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
    });

    it('should check if password exists', async () => {
      mockGetPassword.mockResolvedValue('secretpassword');

      const result = await service.hasPassword('conn-1');

      expect(result).toBe(true);
      expect(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
    });

    it('should return false when password does not exist', async () => {
      mockGetPassword.mockResolvedValue(null);

      const result = await service.hasPassword('conn-1');

      expect(result).toBe(false);
    });

    it('should throw error when store password fails', async () => {
      mockSetPassword.mockRejectedValue(new Error('Keychain locked'));

      await expect(service.storePassword('conn-1', 'password')).rejects.toThrow(
        'Failed to store password for connection conn-1: Keychain locked'
      );
    });

    it('should throw error when get password fails', async () => {
      mockGetPassword.mockRejectedValue(new Error('Access denied'));

      await expect(service.getPassword('conn-1')).rejects.toThrow(
        'Failed to retrieve password for connection conn-1: Access denied'
      );
    });

    it('should throw error when delete password fails', async () => {
      mockDeletePassword.mockRejectedValue(new Error('Keychain error'));

      await expect(service.deletePassword('conn-1')).rejects.toThrow(
        'Failed to delete password for connection conn-1: Keychain error'
      );
    });

    it('should return false for hasPassword when keytar throws', async () => {
      mockGetPassword.mockRejectedValue(new Error('Keychain error'));

      const result = await service.hasPassword('conn-1');

      expect(result).toBe(false);
    });
  });

  describe('passphrase operations', () => {
    it('should store passphrase in keychain', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storePassphrase('conn-1', 'my-passphrase');

      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'conn-1:passphrase',
        'my-passphrase'
      );
    });

    it('should retrieve passphrase from keychain', async () => {
      mockGetPassword.mockResolvedValue('my-passphrase');

      const result = await service.getPassphrase('conn-1');

      expect(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
      expect(result).toBe('my-passphrase');
    });

    it('should return null when passphrase not found', async () => {
      mockGetPassword.mockResolvedValue(null);

      const result = await service.getPassphrase('conn-1');

      expect(result).toBeNull();
    });

    it('should delete passphrase from keychain', async () => {
      mockDeletePassword.mockResolvedValue(undefined);

      await service.deletePassphrase('conn-1');

      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
    });

    it('should check if passphrase exists', async () => {
      mockGetPassword.mockResolvedValue('my-passphrase');

      const result = await service.hasPassphrase('conn-1');

      expect(result).toBe(true);
      expect(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
    });

    it('should return false when passphrase does not exist', async () => {
      mockGetPassword.mockResolvedValue(null);

      const result = await service.hasPassphrase('conn-1');

      expect(result).toBe(false);
    });

    it('should throw error when store passphrase fails', async () => {
      mockSetPassword.mockRejectedValue(new Error('Keychain locked'));

      await expect(service.storePassphrase('conn-1', 'passphrase')).rejects.toThrow(
        'Failed to store passphrase for connection conn-1: Keychain locked'
      );
    });

    it('should throw error when get passphrase fails', async () => {
      mockGetPassword.mockRejectedValue(new Error('Access denied'));

      await expect(service.getPassphrase('conn-1')).rejects.toThrow(
        'Failed to retrieve passphrase for connection conn-1: Access denied'
      );
    });

    it('should throw error when delete passphrase fails', async () => {
      mockDeletePassword.mockRejectedValue(new Error('Keychain error'));

      await expect(service.deletePassphrase('conn-1')).rejects.toThrow(
        'Failed to delete passphrase for connection conn-1: Keychain error'
      );
    });

    it('should return false for hasPassphrase when keytar throws', async () => {
      mockGetPassword.mockRejectedValue(new Error('Keychain error'));

      const result = await service.hasPassphrase('conn-1');

      expect(result).toBe(false);
    });
  });

  describe('bulk operations', () => {
    it('should store both password and passphrase', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storeCredentials('conn-1', {
        password: 'secretpassword',
        passphrase: 'my-passphrase',
      });

      expect(mockSetPassword).toHaveBeenCalledTimes(2);
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'conn-1:password',
        'secretpassword'
      );
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'conn-1:passphrase',
        'my-passphrase'
      );
    });

    it('should store only password when passphrase not provided', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storeCredentials('conn-1', {
        password: 'secretpassword',
      });

      expect(mockSetPassword).toHaveBeenCalledTimes(1);
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'conn-1:password',
        'secretpassword'
      );
    });

    it('should store only passphrase when password not provided', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storeCredentials('conn-1', {
        passphrase: 'my-passphrase',
      });

      expect(mockSetPassword).toHaveBeenCalledTimes(1);
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'conn-1:passphrase',
        'my-passphrase'
      );
    });

    it('should do nothing when no credentials provided', async () => {
      await service.storeCredentials('conn-1', {});

      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it('should delete all credentials', async () => {
      mockDeletePassword.mockResolvedValue(undefined);

      await service.deleteAllCredentials('conn-1');

      expect(mockDeletePassword).toHaveBeenCalledTimes(2);
      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
    });

    it('should not fail when deleting non-existent credentials', async () => {
      mockDeletePassword.mockRejectedValue(new Error('Not found'));

      // Should not throw
      await expect(service.deleteAllCredentials('conn-1')).resolves.not.toThrow();
    });

    it('should continue deleting when one credential fails', async () => {
      mockDeletePassword
        .mockRejectedValueOnce(new Error('Password not found'))
        .mockResolvedValueOnce(undefined);

      await service.deleteAllCredentials('conn-1');

      expect(mockDeletePassword).toHaveBeenCalledTimes(2);
    });
  });

  describe('service namespacing', () => {
    it('should use correct service name for all operations', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storePassword('conn-1', 'pass');
      await service.storePassphrase('conn-1', 'phrase');

      const calls = mockSetPassword.mock.calls;
      expect(calls.every((call) => call[0] === 'emdash-ssh')).toBe(true);
    });

    it('should use correct key format for password', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storePassword('my-connection', 'password');

      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'my-connection:password',
        'password'
      );
    });

    it('should use correct key format for passphrase', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storePassphrase('my-connection', 'passphrase');

      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-ssh',
        'my-connection:passphrase',
        'passphrase'
      );
    });
  });
});
