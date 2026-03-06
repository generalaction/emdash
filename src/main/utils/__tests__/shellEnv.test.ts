import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getShellEnvVar, detectSshAuthSock, initializeShellEnvironment } from '../shellEnv';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { statSync, readdirSync } from 'fs';

const mockedExecSync = vi.mocked(execSync);
const mockedStatSync = vi.mocked(statSync);
const mockedReaddirSync = vi.mocked(readdirSync);

describe('shellEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env
    process.env = { ...originalEnv };
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getShellEnvVar', () => {
    it('should return environment variable from shell', () => {
      mockedExecSync.mockReturnValue('/path/to/socket');

      const result = getShellEnvVar('SSH_AUTH_SOCK');

      expect(result).toBe('/path/to/socket');
      expect(mockedExecSync).toHaveBeenCalledWith(
        expect.stringContaining('printenv SSH_AUTH_SOCK'),
        expect.objectContaining({ encoding: 'utf8', timeout: 5000 })
      );
    });

    it('should return undefined when variable is empty', () => {
      mockedExecSync.mockReturnValue('');

      const result = getShellEnvVar('SSH_AUTH_SOCK');

      expect(result).toBeUndefined();
    });

    it('should return undefined when shell command fails', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = getShellEnvVar('SSH_AUTH_SOCK');

      expect(result).toBeUndefined();
    });
  });

  describe('detectSshAuthSock', () => {
    it('should return existing SSH_AUTH_SOCK if already set', () => {
      process.env.SSH_AUTH_SOCK = '/existing/socket';
      // On macOS, launchctl is tried first but may fail
      mockedExecSync.mockImplementation(() => {
        throw new Error('launchctl failed');
      });

      const result = detectSshAuthSock();

      expect(result).toBe('/existing/socket');
    });

    it('should detect SSH_AUTH_SOCK when not in process.env', () => {
      delete process.env.SSH_AUTH_SOCK;
      mockedExecSync.mockReturnValue('/shell/detected/socket');

      const result = detectSshAuthSock();

      expect(result).toBe('/shell/detected/socket');
    });

    it('should check common locations as fallback', () => {
      delete process.env.SSH_AUTH_SOCK;
      mockedExecSync.mockImplementation(() => {
        throw new Error('Shell detection failed');
      });

      // Mock readdirSync to simulate finding a socket
      mockedReaddirSync.mockImplementation((dirPath) => {
        const pathStr = dirPath.toString();
        if (pathStr.includes('com.apple.launchd')) {
          return ['Listeners'] as any;
        }
        return [] as any;
      });

      // Mock statSync to indicate it's a socket
      mockedStatSync.mockReturnValue({ isSocket: () => true } as any);

      const result = detectSshAuthSock();

      // Should find the socket in launchd directory
      expect(result).toBeTruthy();
    });

    it.skipIf(process.platform !== 'darwin')(
      'should prefer launchctl value over process.env on macOS',
      () => {
        process.env.SSH_AUTH_SOCK = '/private/tmp/com.apple.launchd.XXX/Listeners';
        mockedExecSync.mockReturnValue(
          '/Users/test/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock\n'
        );

        const result = detectSshAuthSock();

        expect(result).toBe(
          '/Users/test/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'
        );
      }
    );

    it('should return undefined when no socket is found', () => {
      delete process.env.SSH_AUTH_SOCK;
      mockedExecSync.mockImplementation(() => {
        throw new Error('Shell detection failed');
      });
      mockedReaddirSync.mockImplementation(() => [] as any);

      const result = detectSshAuthSock();

      expect(result).toBeUndefined();
    });
  });

  describe('initializeShellEnvironment', () => {
    it('should set process.env.SSH_AUTH_SOCK when socket is detected', () => {
      delete process.env.SSH_AUTH_SOCK;
      mockedExecSync.mockReturnValue('/detected/socket');

      initializeShellEnvironment();

      expect(process.env.SSH_AUTH_SOCK).toBe('/detected/socket');
    });

    it('should fall back to existing SSH_AUTH_SOCK when launchctl fails', () => {
      process.env.SSH_AUTH_SOCK = '/existing/socket';
      // On macOS, launchctl is tried first but may fail
      mockedExecSync.mockImplementation(() => {
        throw new Error('launchctl failed');
      });

      initializeShellEnvironment();

      expect(process.env.SSH_AUTH_SOCK).toBe('/existing/socket');
    });
  });
});
