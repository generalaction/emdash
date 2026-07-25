import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { ensureHooksInstalled } from './hook-config-service';

const PLUGIN_PATH = '.omp/extensions/emdash-hook.ts';
const PLUGIN_CONTENT = 'export default function () {}';
const TASK_PATH = '/remote/workspace/task';

const installPlugin = vi.fn(async (fs: { write(p: string, c: string): Promise<void> }) => {
  await fs.write(PLUGIN_PATH, PLUGIN_CONTENT);
  return [PLUGIN_PATH];
});

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn(() => ({
    capabilities: { hooks: { kind: 'plugin', scope: 'workspace', supportedEvents: ['stop'] } },
    behavior: { plugins: { installPlugin } },
  })),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn(async () => ({ writeAgentConfigToGitIgnore: true })) },
}));

/**
 * Minimal remote host: an in-memory file map plus the handful of shell commands
 * createRemotePluginFs shells out for (mkdir/mv/rm) and the `$HOME` probe.
 */
function makeRemoteHost(): {
  files: Map<string, string>;
  host: { kind: 'ssh'; ctx: IExecutionContext; files: IFilesRuntime };
} {
  const files = new Map<string, string>();

  const ctx = {
    supportsLocalSpawn: false,
    async exec(command: string, args: string[] = []) {
      if (command === 'sh') return { stdout: '/home/remote', stderr: '' };
      if (command === 'mv') {
        const [from, to] = args;
        const content = files.get(from);
        if (content === undefined) throw new Error(`no such file: ${from}`);
        files.delete(from);
        files.set(to, content);
      }
      if (command === 'rm') for (const arg of args) files.delete(arg);
      return { stdout: '', stderr: '' };
    },
    async execStreaming() {},
    dispose() {},
  } satisfies Partial<IExecutionContext> as unknown as IExecutionContext;

  const fileSystem = {
    async readText(target: string) {
      const content = files.get(target);
      return content === undefined
        ? {
            success: false as const,
            error: { type: 'fs-error', path: target, message: 'ENOENT', code: 'ENOENT' },
          }
        : { success: true as const, data: { content } };
    },
    async writeText(target: string, content: string) {
      files.set(target, content);
      return { success: true as const, data: {} };
    },
    async exists(target: string) {
      return { success: true as const, data: files.has(target) };
    },
  } as unknown as IFileSystem;

  const filesRuntime = {
    fileSystem: () => ({ success: true as const, data: fileSystem }),
  } as unknown as IFilesRuntime;

  return { files, host: { kind: 'ssh', ctx, files: filesRuntime } };
}

beforeEach(() => {
  installPlugin.mockClear();
});

describe('ensureHooksInstalled', () => {
  it('installs a workspace plugin on the remote host for ssh conversations', async () => {
    const { files, host } = makeRemoteHost();

    const available = await ensureHooksInstalled({
      providerId: 'oh-my-pi',
      taskPath: TASK_PATH,
      host,
    });

    expect(available).toBe(true);
    expect(files.get(path.posix.join(TASK_PATH, PLUGIN_PATH))).toBe(PLUGIN_CONTENT);
    expect(files.get(path.posix.join(TASK_PATH, '.gitignore'))).toBe(`${PLUGIN_PATH}\n`);
  });

  it('reports hooks unavailable when the remote filesystem cannot be opened', async () => {
    const { host } = makeRemoteHost();
    const files = {
      fileSystem: () => ({
        success: false as const,
        error: { kind: 'unavailable', message: 'connection closed' },
      }),
    } as unknown as IFilesRuntime;

    const available = await ensureHooksInstalled({
      providerId: 'oh-my-pi',
      taskPath: TASK_PATH,
      host: { ...host, files },
    });

    expect(available).toBe(false);
    expect(installPlugin).not.toHaveBeenCalled();
  });
});
