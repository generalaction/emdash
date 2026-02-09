import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { SshService } from '../SshService';
import { SshCredentialService } from '../SshCredentialService';
import { SshConfig } from '../../../../shared/ssh/types';

// Mock ssh2 Client
const mockClientInstance = {
  on: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  exec: vi.fn(),
  sftp: vi.fn(),
};

vi.mock('ssh2', () => ({
  Client: vi.fn().mockImplementation(() => mockClientInstance),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-123'),
}));

describe('SshService', () => {
  let service: SshService;
  let mockCredentialService: {
    getPassword: Mock;
    getPassphrase: Mock;
    storePassword: Mock;
    storePassphrase: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCredentialService = {
      getPassword: vi.fn(),
      getPassphrase: vi.fn(),
      storePassword: vi.fn(),
      storePassphrase: vi.fn(),
    };
    service = new SshService(mockCredentialService as unknown as SshCredentialService);
  });

  describe('buildConnectConfig - via connect method', () => {
    it('should build correct config for password authentication', async () => {
      const config: SshConfig = {
        id: 'conn-1',
        name: 'Test Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('testpassword');

      // Capture the connect config
      let capturedConfig: any;
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        capturedConfig = cfg;
        // Simulate successful connection
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      await service.connect(config);

      expect(capturedConfig).toMatchObject({
        host: 'example.com',
        port: 22,
        username: 'testuser',
        password: 'testpassword',
        readyTimeout: 20000,
        keepaliveInterval: 60000,
        keepaliveCountMax: 3,
      });
    });

    it('should build correct config for key authentication', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as Mock).mockResolvedValue('-----BEGIN OPENSSH PRIVATE KEY-----');

      const config: SshConfig = {
        id: 'conn-2',
        name: 'Key Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
      };

      mockCredentialService.getPassphrase.mockResolvedValue(null);

      let capturedConfig: any;
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        capturedConfig = cfg;
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      await service.connect(config);

      expect(readFile).toHaveBeenCalledWith('/home/user/.ssh/id_rsa', 'utf-8');
      expect(capturedConfig).toMatchObject({
        host: 'example.com',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      });
    });

    it('should include passphrase for encrypted key', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as Mock).mockResolvedValue('-----BEGIN OPENSSH PRIVATE KEY-----');

      const config: SshConfig = {
        id: 'conn-3',
        name: 'Encrypted Key',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
      };

      mockCredentialService.getPassphrase.mockResolvedValue('keypassphrase');

      let capturedConfig: any;
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        capturedConfig = cfg;
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      await service.connect(config);

      expect(capturedConfig).toMatchObject({
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
        passphrase: 'keypassphrase',
      });
    });

    it('should build correct config for agent authentication', async () => {
      const originalEnv = process.env.SSH_AUTH_SOCK;
      process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent.sock';

      const config: SshConfig = {
        id: 'conn-4',
        name: 'Agent Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'agent',
      };

      let capturedConfig: any;
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        capturedConfig = cfg;
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      await service.connect(config);

      expect(capturedConfig).toMatchObject({
        agent: '/tmp/ssh-agent.sock',
      });

      process.env.SSH_AUTH_SOCK = originalEnv;
    });
  });

  describe('authentication error handling', () => {
    it('should throw error when agent socket is not set', async () => {
      const originalEnv = process.env.SSH_AUTH_SOCK;
      delete process.env.SSH_AUTH_SOCK;

      const config: SshConfig = {
        id: 'conn-5',
        name: 'Agent Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'agent',
      };

      // Suppress error event
      service.on('error', () => {});

      await expect(service.connect(config)).rejects.toThrow(/SSH agent authentication failed/);

      process.env.SSH_AUTH_SOCK = originalEnv;
    });

    it('should throw error when password is not found', async () => {
      const config: SshConfig = {
        id: 'conn-6',
        name: 'Password Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue(null);
      service.on('error', () => {});

      await expect(service.connect(config)).rejects.toThrow(
        'No password found for connection conn-6'
      );
    });

    it('should throw error when private key path is missing', async () => {
      const config: SshConfig = {
        id: 'conn-7',
        name: 'Key Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'key',
      };

      service.on('error', () => {});

      await expect(service.connect(config)).rejects.toThrow(
        'Private key path is required for key authentication'
      );
    });

    it('should throw error when private key file cannot be read', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as Mock).mockRejectedValue(new Error('Permission denied'));

      const config: SshConfig = {
        id: 'conn-8',
        name: 'Key Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
      };

      service.on('error', () => {});

      await expect(service.connect(config)).rejects.toThrow(
        'Failed to read private key: Permission denied'
      );
    });
  });

  describe('connection management', () => {
    it('should generate UUID when id is not provided', async () => {
      const config: SshConfig = {
        name: 'Test Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('testpassword');
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      const connectionId = await service.connect(config);

      expect(connectionId).toBe('test-uuid-123');
    });

    it('should track connection state', async () => {
      const config: SshConfig = {
        id: 'conn-9',
        name: 'Test Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('testpassword');
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      expect(service.isConnected('conn-9')).toBe(false);
      await service.connect(config);
      expect(service.isConnected('conn-9')).toBe(true);
    });

    it('should list connections', async () => {
      const config1: SshConfig = {
        id: 'conn-a',
        name: 'Connection A',
        host: 'host-a.com',
        port: 22,
        username: 'user-a',
        authType: 'password',
      };

      const config2: SshConfig = {
        id: 'conn-b',
        name: 'Connection B',
        host: 'host-b.com',
        port: 22,
        username: 'user-b',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('testpassword');

      // Setup mock to capture and trigger ready handlers
      const readyHandlers: Array<() => void> = [];
      mockClientInstance.on.mockImplementation(
        (event: string, handler: (...args: any[]) => void) => {
          if (event === 'ready') {
            readyHandlers.push(handler as () => void);
          }
          return mockClientInstance;
        }
      );

      mockClientInstance.connect.mockImplementation(() => {
        // Trigger the last registered ready handler
        const handler = readyHandlers[readyHandlers.length - 1];
        if (handler) {
          setTimeout(() => handler(), 0);
        }
      });

      await service.connect(config1);
      await service.connect(config2);

      const connections = service.listConnections();
      expect(connections).toContain('conn-a');
      expect(connections).toContain('conn-b');
    });

    it('should get connection info', async () => {
      const config: SshConfig = {
        id: 'conn-20',
        name: 'Test Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('testpassword');
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      await service.connect(config);

      const info = service.getConnectionInfo('conn-20');
      expect(info).not.toBeNull();
      expect(info?.connectedAt).toBeInstanceOf(Date);
      expect(info?.lastActivity).toBeInstanceOf(Date);
    });

    it('should return null for non-existent connection info', async () => {
      const info = service.getConnectionInfo('non-existent');
      expect(info).toBeNull();
    });

    it('should get all connections', async () => {
      const config: SshConfig = {
        id: 'conn-21',
        name: 'Test Connection',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('testpassword');
      mockClientInstance.connect.mockImplementation((cfg: any) => {
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      await service.connect(config);

      const connections = service.getAllConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0].id).toBe('conn-21');
    });

    it('should handle disconnect for non-existent connection', async () => {
      await service.disconnect('non-existent');
      expect(mockClientInstance.end).not.toHaveBeenCalled();
    });
  });

  describe('escapeShellArg', () => {
    it('should escape single quotes in shell arguments', async () => {
      const config: SshConfig = {
        id: 'conn-esc',
        name: 'Test',
        host: 'example.com',
        port: 22,
        username: 'user',
        authType: 'password',
      };

      mockCredentialService.getPassword.mockResolvedValue('password');

      // Use exec to test escapeShellArg indirectly
      const { EventEmitter } = await import('events');
      const mockStream = new EventEmitter();
      (mockStream as any).stderr = new EventEmitter();

      mockClientInstance.connect.mockImplementation((cfg: any) => {
        const readyHandler = mockClientInstance.on.mock.calls.find(
          (call: any) => call[0] === 'ready'
        )?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      mockClientInstance.exec.mockImplementation(
        (command: string, callback: (err: Error | null, stream: any) => void) => {
          callback(null, mockStream);
          setTimeout(() => {
            mockStream.emit('close', 0);
          }, 0);
        }
      );

      await service.connect(config);
      await service.executeCommand('conn-esc', 'ls', "/path/with'quotes");

      // Verify the command was escaped
      const execCall = mockClientInstance.exec.mock.calls[0];
      expect(execCall[0]).toContain("'");
      expect(execCall[0]).toContain('"\'"');
    });
  });
});
