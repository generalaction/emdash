import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { parseNativeAbsolute } from '#primitives/path/api';
import {
  CORE_DEPENDENCIES,
  REQUIRED_CORE_DEPENDENCIES,
} from '#services/host-dependencies/api/core-dependencies';
import { languageServers } from '../api/server-catalog';
import { getServerProfile, resolveLanguageServer } from './server-registry';

const parsed = parseNativeAbsolute(process.cwd());
if (!parsed.success) throw new Error('invalid root');
const key = { serverId: 'typescript', root: parsed.data };

describe('language server resolution', () => {
  it('has a host profile for each selectable server', () => {
    for (const server of languageServers) {
      const profile = getServerProfile(server.id);
      const dependency = CORE_DEPENDENCIES.find((item) => item.id === profile.dependencyId);
      expect(dependency, server.id).toBeDefined();
      expect(REQUIRED_CORE_DEPENDENCIES).not.toContain(dependency);
      expect(dependency?.binaryNames).toHaveLength(1);
      for (const platform of ['macos', 'linux', 'windows'] as const) {
        expect(
          dependency?.installCommands?.[platform]?.length,
          `${server.id} on ${platform}`
        ).toBeGreaterThan(0);
      }
    }
  });
  it.each([
    ['bash', 'bash-language-server', ['start']],
    ['go', 'gopls', []],
    ['rust', 'rust-analyzer', []],
    ['python', 'pyright-langserver', ['--stdio']],
    ['cpp', 'clangd', []],
    ['json', 'vscode-json-language-server', ['--stdio']],
    ['yaml', 'yaml-language-server', ['--stdio']],
    ['html', 'vscode-html-language-server', ['--stdio']],
    ['css', 'vscode-css-language-server', ['--stdio']],
  ])('resolves only the selected %s executable', async (serverId, dependencyId, args) => {
    const executable = `/tools with spaces/${dependencyId}`;
    const resolver = {
      resolve: vi.fn(async () =>
        ok({
          id: dependencyId,
          command: dependencyId,
          path: executable,
          realpath: executable,
          source: { kind: 'auto' as const },
        })
      ),
    };
    const env = { PATH: '/host/toolchain/bin', GOPATH: '/host/go', CARGO_HOME: '/host/cargo' };
    const launch = await resolveLanguageServer({ ...key, serverId }, resolver, env);
    expect(launch).toMatchObject({ command: executable, args, env });
    expect(resolver.resolve.mock.calls).toEqual([[dependencyId]]);
  });
  it('rejects unknown IDs before executable lookup', async () => {
    const resolver = { resolve: vi.fn() };
    await expect(
      resolveLanguageServer({ ...key, serverId: 'unknown' }, resolver, {})
    ).rejects.toThrow(/unsupported/i);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
  it('resolves a hoisted project compiler without loading project code', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-sdk-'));
    try {
      const lib = path.join(root, 'node_modules/typescript/lib');
      const project = path.join(root, 'packages/app');
      await mkdir(lib, { recursive: true });
      await mkdir(project, { recursive: true });
      await writeFile(path.join(lib, 'tsserver.js'), 'throw new Error("must never execute");');
      const parsed = parseNativeAbsolute(project);
      if (!parsed.success) throw new Error('invalid root');
      const config = await getServerProfile('typescript').configure?.(parsed.data, {});
      expect(config?.initializationOptions).toMatchObject({
        tsserver: { path: path.join(lib, 'tsserver.js') },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('uses the host-selected executable and captured environment without constructing shell text', async () => {
    const resolver = {
      resolve: vi.fn(async () =>
        ok({
          id: 'typescript-language-server',
          command: 'typescript-language-server',
          path: '/tools with spaces/typescript-language-server',
          realpath: '/tools with spaces/lib/cli.mjs',
          source: { kind: 'auto' as const },
        })
      ),
    };
    const env = { PATH: '/host/bin', PROJECT_SETTING: 'value' };
    const launch = await resolveLanguageServer(key, resolver, env);
    expect(launch.command).toBe('/tools with spaces/typescript-language-server');
    expect(launch.args).toEqual(['--stdio']);
    expect(launch.env).toEqual(env);
    expect(resolver.resolve).toHaveBeenCalledWith('typescript-language-server');
  });
  it('provides actionable guidance when the server is absent on this host', async () => {
    const resolver = {
      resolve: vi.fn(async () =>
        err({ type: 'missing' as const, id: 'typescript-language-server' })
      ),
    };
    await expect(resolveLanguageServer(key, resolver, {})).rejects.toThrow(/host.*dependencies/i);
  });
});
