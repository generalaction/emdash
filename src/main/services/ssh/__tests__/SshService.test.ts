import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { spawn, execFile } from 'child_process';
import { SshService } from '../SshService';
import { SshCredentialService } from '../SshCredentialService';
import { SshConfig } from '../../../../shared/ssh/types';

const mockSpawn = spawn as unknown as Mock;
const mockExecFile = execFile as unknown as Mock;

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
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-123'),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Prevent keytar/native module loading through SshService's module-level singleton.
vi.mock('../SshCredentialService', () => ({
  SshCredentialService: class MockSshCredentialService {
    getPassword = vi.fn();
    getPassphrase = vi.fn();
    storePassword = vi.fn();
    storePassphrase = vi.fn();
  },
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

  describe('GSSAPI/Kerberos authentication', () => {
    /**
     * Helper: sets up mockSpawn to return a process that auto-triggers 'close'
     * with the given exit code via queueMicrotask, after all handlers are registered.
     */
    function setupGssapiSpawn(exitCode: number, stderrOutput?: string) {
      mockSpawn.mockImplementation(() => {
        const stderrHandlers: Record<string, (...args: any[]) => void> = {};
        const mockProc = {
          on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            if (event === 'close') {
              // Fire close asynchronously so all handlers are registered first
              queueMicrotask(() => {
                if (stderrOutput && stderrHandlers['data']) {
                  stderrHandlers['data'](Buffer.from(stderrOutput));
                }
                handler(exitCode);
              });
            }
          }),
          stderr: {
            on: vi.fn((event: string, handler: (...args: any[]) => void) => {
              stderrHandlers[event] = handler;
            }),
          },
          stdout: { on: vi.fn() },
          stdin: { on: vi.fn() },
          killed: false,
          kill: vi.fn(),
        };
        return mockProc;
      });
    }

    it('should establish a GSSAPI connection via ControlMaster', async () => {
      const config: SshConfig = {
        id: 'conn-gssapi-1',
        name: 'GSSAPI Connection',
        host: 'krb.example.com',
        port: 22,
        username: 'krbuser',
        authType: 'gssapi',
      };

      setupGssapiSpawn(0);

      const connectionId = await service.connect(config);
      expect(connectionId).toBe('conn-gssapi-1');
      expect(service.isConnected('conn-gssapi-1')).toBe(true);
      expect(service.isGssapiConnection('conn-gssapi-1')).toBe(true);

      // Verify spawn was called with GSSAPI flags
      expect(mockSpawn).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining([
          '-f',
          '-N',
          '-M',
          '-o',
          'GSSAPIAuthentication=yes',
          '-l',
          'krbuser',
          'krb.example.com',
        ]),
        expect.any(Object)
      );
    });

    it('should reject when GSSAPI authentication fails', async () => {
      const config: SshConfig = {
        id: 'conn-gssapi-fail',
        name: 'GSSAPI Fail',
        host: 'krb.example.com',
        port: 22,
        username: 'krbuser',
        authType: 'gssapi',
      };

      setupGssapiSpawn(255, 'Permission denied');

      service.on('error', () => {});
      await expect(service.connect(config)).rejects.toThrow('Permission denied');
    });

    it('should throw SFTP error for GSSAPI connections', async () => {
      const config: SshConfig = {
        id: 'conn-gssapi-sftp',
        name: 'GSSAPI SFTP',
        host: 'krb.example.com',
        port: 22,
        username: 'krbuser',
        authType: 'gssapi',
      };

      setupGssapiSpawn(0);
      await service.connect(config);

      await expect(service.getSftp('conn-gssapi-sftp')).rejects.toThrow(
        'SFTP is not available for GSSAPI connections'
      );
    });

    it('should execute commands via system ssh for GSSAPI connections', async () => {
      const config: SshConfig = {
        id: 'conn-gssapi-exec',
        name: 'GSSAPI Exec',
        host: 'krb.example.com',
        port: 22,
        username: 'krbuser',
        authType: 'gssapi',
      };

      setupGssapiSpawn(0);
      await service.connect(config);

      // Mock execFile for command execution
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: any, callback: (...cbArgs: any[]) => void) => {
          callback(null, 'hello world\n', '');
        }
      );

      const result = await service.executeCommand('conn-gssapi-exec', 'echo hello world');
      expect(result.stdout).toBe('hello world');
      expect(result.exitCode).toBe(0);
      expect(mockExecFile).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining(['-o', 'ControlMaster=no', 'krb.example.com']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should return GSSAPI connection info', async () => {
      const config: SshConfig = {
        id: 'conn-gssapi-info',
        name: 'GSSAPI Info',
        host: 'krb.example.com',
        port: 22,
        username: 'krbuser',
        authType: 'gssapi',
      };

      setupGssapiSpawn(0);
      await service.connect(config);

      const info = service.getConnectionInfo('conn-gssapi-info');
      expect(info).not.toBeNull();
      expect(info?.connectedAt).toBeInstanceOf(Date);

      const connections = service.listConnections();
      expect(connections).toContain('conn-gssapi-info');
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
      expect(execCall[0]).toContain("'\\''");
    });
  });
});
