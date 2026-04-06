import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
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
const shellValue = (value: string) =>
  `__EMDASH_SHELL_VALUE_START__\n${value}\n__EMDASH_SHELL_VALUE_END__\n`;

describe('shellEnv', () => {
  const originalEnv = process.env;
  const fallbackUtf8Locale =
    process.platform === 'darwin'
      ? 'en_US.UTF-8'
      : process.platform === 'win32'
        ? undefined
        : 'C.UTF-8';
  const shellLookup = (values: Partial<Record<string, string>>) => (command: string) => {
    // Batched locale call: returns values separated by ---
    if (command.includes('echo "---"')) {
      const keys = [...command.matchAll(/printenv ([A-Z0-9_]+)/g)].map((m) => m[1]!);
      return keys.map((k) => values[k] ?? '').join('\n---\n');
    }
    // Single var call
    const match = command.match(/printenv ([A-Z0-9_]+)/);
    if (!match) throw new Error('Command failed');
    return shellValue(values[match[1]!] ?? '');
  };

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
      mockedExecSync.mockReturnValue(shellValue('/path/to/socket'));

      const result = getShellEnvVar('SSH_AUTH_SOCK');

      expect(result).toBe('/path/to/socket');
      expect(mockedExecSync).toHaveBeenCalledWith(
        expect.stringContaining('printenv SSH_AUTH_SOCK'),
        expect.objectContaining({ encoding: 'utf8', timeout: 5000 })
      );
    });

    it('should return undefined when variable is empty', () => {
      mockedExecSync.mockReturnValue(shellValue(''));

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

    it('should ignore prompt escape noise around shell output', () => {
      mockedExecSync.mockReturnValue(
        `\u001b]1337;RemoteHost=test@MacBookPro\u0007${shellValue('/path/to/socket')}\u001b]1337;CurrentDir=/tmp\u0007`
      );

      const result = getShellEnvVar('SSH_AUTH_SOCK');

      expect(result).toBe('/path/to/socket');
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
      mockedExecSync.mockImplementation((command) => {
        if (typeof command === 'string' && command.includes('launchctl getenv SSH_AUTH_SOCK')) {
          throw new Error('launchctl failed');
        }
        return shellValue('/shell/detected/socket');
      });

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
      delete process.env.LANG;
      delete process.env.LC_CTYPE;
      delete process.env.LC_ALL;
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: 'C.UTF-8',
          LC_CTYPE: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
        })
      );

      initializeShellEnvironment();

      expect(process.env.SSH_AUTH_SOCK).toBe('/detected/socket');
      expect(process.env.LANG).toBe('C.UTF-8');
      expect(process.env.LC_CTYPE).toBe('C.UTF-8');
      expect(process.env.LC_ALL).toBe('C.UTF-8');
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

    it('should drop relative CLAUDE_CONFIG_DIR values', () => {
      process.env.CLAUDE_CONFIG_DIR = '.claude';
      delete process.env.LANG;
      delete process.env.LC_CTYPE;
      delete process.env.LC_ALL;
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          CLAUDE_CONFIG_DIR: '.claude',
          LANG: fallbackUtf8Locale,
          LC_CTYPE: fallbackUtf8Locale,
          LC_ALL: fallbackUtf8Locale,
        })
      );

      initializeShellEnvironment();

      expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    it('should expand shell CLAUDE_CONFIG_DIR values that start with ~/', () => {
      delete process.env.CLAUDE_CONFIG_DIR;
      delete process.env.LANG;
      delete process.env.LC_CTYPE;
      delete process.env.LC_ALL;
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          CLAUDE_CONFIG_DIR: '~/.claude-custom',
          LANG: fallbackUtf8Locale,
          LC_CTYPE: fallbackUtf8Locale,
          LC_ALL: fallbackUtf8Locale,
        })
      );

      initializeShellEnvironment();

      expect(process.env.CLAUDE_CONFIG_DIR).toBe(path.join(os.homedir(), '.claude-custom'));
    });

    it('should not overwrite explicit locale env values', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.LC_CTYPE = 'sr_RS.UTF-8';
      process.env.LC_ALL = 'C.UTF-8';
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: 'ignored.UTF-8',
          LC_CTYPE: 'ignored.UTF-8',
          LC_ALL: 'ignored.UTF-8',
        })
      );

      initializeShellEnvironment();

      expect(process.env.LANG).toBe('en_US.UTF-8');
      expect(process.env.LC_CTYPE).toBe('sr_RS.UTF-8');
      expect(process.env.LC_ALL).toBe('C.UTF-8');
    });

    it('should replace inherited non-UTF-8 locale values with shell UTF-8 values', () => {
      process.env.LANG = 'C';
      process.env.LC_CTYPE = 'POSIX';
      process.env.LC_ALL = 'C';
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: 'en_US.UTF-8',
          LC_CTYPE: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
        })
      );

      initializeShellEnvironment();

      expect(process.env.LANG).toBe('en_US.UTF-8');
      expect(process.env.LC_CTYPE).toBe('en_US.UTF-8');
      expect(process.env.LC_ALL).toBe('en_US.UTF-8');
    });

    it('should fall back to platform UTF-8 locale when shell exposes no locale values', () => {
      delete process.env.LANG;
      delete process.env.LC_CTYPE;
      delete process.env.LC_ALL;
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: '',
          LC_CTYPE: '',
          LC_ALL: '',
        })
      );

      initializeShellEnvironment();

      expect(process.env.LANG).toBe(fallbackUtf8Locale);
      expect(process.env.LC_CTYPE).toBe(fallbackUtf8Locale);
      expect(process.env.LC_ALL).toBeUndefined();
    });

    it('should fall back to platform UTF-8 locale when shell exposes only non-UTF-8 locale values', () => {
      process.env.LANG = 'C';
      process.env.LC_CTYPE = 'C';
      process.env.LC_ALL = 'C';
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: 'C',
          LC_CTYPE: 'POSIX',
          LC_ALL: 'C',
        })
      );

      initializeShellEnvironment();

      expect(process.env.LANG).toBe(fallbackUtf8Locale);
      expect(process.env.LC_CTYPE).toBe(fallbackUtf8Locale);
      expect(process.env.LC_ALL).toBeUndefined();
    });

    it('should strip AppImage env leakage from the probed shell', () => {
      // Regression test: shellEnv.ts used to hand `...process.env` wholesale
      // to the login shell it spawns for env probing. On Linux AppImage
      // installs this meant the child shell saw APPIMAGE, APPDIR, and the
      // `/tmp/.mount_*` entries on PATH. If any shell-init plugin (starship,
      // mise, oh-my-zsh plugins) exec'd a binary by name through PATH, the
      // exec could resolve back into the AppImage mount and re-enter Emdash's
      // main process, which would run this probe again — a fork bomb.
      //
      // The fix routes the probe's env through buildExternalToolEnv() from
      // ./childProcessEnv. These assertions lock the behavior in.
      const appDir = '/tmp/.mount_emdashAbCd';
      process.env.APPIMAGE = '/home/user/emdash.AppImage';
      process.env.APPDIR = appDir;
      process.env.ARGV0 = 'AppRun';
      process.env.OWD = '/tmp';
      process.env.PATH = `/usr/local/bin:${appDir}/usr/bin:/usr/bin`;
      process.env.LD_LIBRARY_PATH = `${appDir}/usr/lib:/usr/local/cuda/lib64`;
      delete process.env.LANG;
      delete process.env.LC_CTYPE;
      delete process.env.LC_ALL;

      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: 'C.UTF-8',
          LC_CTYPE: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
        })
      );

      initializeShellEnvironment();

      // Every execSync invocation in this module should have been handed a
      // scrubbed env — no AppImage keys, no mount paths in PATH-like vars.
      expect(mockedExecSync).toHaveBeenCalled();
      for (const call of mockedExecSync.mock.calls) {
        const options = call[1] as { env?: NodeJS.ProcessEnv } | undefined;
        const env = options?.env;
        expect(env).toBeDefined();
        if (!env) continue;
        expect(env.APPIMAGE).toBeUndefined();
        expect(env.APPDIR).toBeUndefined();
        expect(env.ARGV0).toBeUndefined();
        expect(env.OWD).toBeUndefined();
        expect(env.PATH).toBeDefined();
        expect(env.PATH).not.toContain(appDir);
        expect(env.PATH).not.toContain('/tmp/.mount_');
        expect(env.LD_LIBRARY_PATH).toBeDefined();
        expect(env.LD_LIBRARY_PATH).not.toContain(appDir);
        expect(env.LD_LIBRARY_PATH).not.toContain('/tmp/.mount_');
      }
    });

    it('should drop non-UTF-8 overrides when LANG is already UTF-8', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.LC_CTYPE = 'C';
      delete process.env.LC_ALL;
      mockedExecSync.mockImplementation(
        shellLookup({
          SSH_AUTH_SOCK: '/detected/socket',
          LANG: '',
          LC_CTYPE: 'C',
          LC_ALL: '',
        })
      );

      initializeShellEnvironment();

      expect(process.env.LANG).toBe('en_US.UTF-8');
      expect(process.env.LC_CTYPE).toBeUndefined();
      expect(process.env.LC_ALL).toBeUndefined();
    });
  });
});
