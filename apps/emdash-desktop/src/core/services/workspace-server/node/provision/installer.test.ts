import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { workspaceServerLayout } from '../layout';
import {
  buildWorkspaceServerInstallCommand,
  renderWorkspaceServerInstallPrelude,
  workspaceServerInstallVariableNames,
  WorkspaceServerInstaller,
  type WorkspaceServerInstallScriptVariables,
} from './installer';

describe('workspace-server installer command', () => {
  it('uses the managed layout, verifies before extraction, and swaps current atomically', () => {
    const command = buildWorkspaceServerInstallCommand({
      layout: workspaceServerLayout('/home/dev user'),
      version: '1.2.3',
      url: "file:///opt/artifact's/server.tar.gz",
      sha256: 'a'.repeat(64),
    });

    expect(command).toContain("'/home/dev user/.emdash/workspace-server/versions/1.2.3'");
    expect(command.indexOf('mkdir -p -- "$root"')).toBeLessThan(
      command.indexOf('while ! mkdir "$lock"')
    );
    expect(command).toContain('sha256sum -c -');
    expect(command.indexOf('sha256sum -c -')).toBeLessThan(command.indexOf('tar --extract'));
    expect(command).toContain('--strip-components=1');
    expect(command).toContain('mv -Tf');
    expect(command).toContain("'file:///opt/artifact'\\''s/server.tar.gz'");
  });

  it('quotes every injected install-script variable without evaluating shell syntax', () => {
    const variables = Object.fromEntries(
      workspaceServerInstallVariableNames.map((name) => [
        name,
        `${name}: ' " $HOME $(printf injected) \`printf injected\`\n spaced`,
      ])
    ) as WorkspaceServerInstallScriptVariables;
    const prelude = renderWorkspaceServerInstallPrelude(variables);
    const printVariables = workspaceServerInstallVariableNames
      .map((name) => `"$${name}"`)
      .join(' ');
    const result = spawnSync('sh', ['-c', `${prelude}\nprintf '%s\\0' ${printVariables}`]);

    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(result.stdout.toString().split('\0').slice(0, -1)).toEqual(
      workspaceServerInstallVariableNames.map((name) => variables[name])
    );
  });

  it('checks glibc and executes the checksum-backed install command through the SSH proxy', async () => {
    const execScript = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'glibc 2.36\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const ensureProxy = vi.fn(async () => ({ execScript }) as never);
    const artifacts = {
      resolve: vi.fn(async () => ({
        url: 'file:///opt/emdash-artifacts/server.tar.gz',
        sha256: 'a'.repeat(64),
      })),
    };
    const installer = new WorkspaceServerInstaller({ ensureProxy }, artifacts);

    await installer.install(
      'ssh-1',
      { home: '/home/devuser', os: 'linux', arch: 'arm64' },
      workspaceServerLayout('/home/devuser'),
      '1.2.3'
    );

    expect(ensureProxy).toHaveBeenCalledWith('ssh-1');
    expect(artifacts.resolve).toHaveBeenCalledWith(
      {
        os: 'linux',
        arch: 'arm64',
        version: '1.2.3',
      },
      { signal: undefined }
    );
    expect(execScript).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('sha256sum -c -'),
      expect.objectContaining({ timeoutMs: 300_000 })
    );
  });

  it('rejects a current link that points outside the managed versions directory', async () => {
    const exec = vi.fn(async () => ({
      stdout: '/tmp/versions/1.2.3\n',
      stderr: '',
      exitCode: 0,
    }));
    const installer = new WorkspaceServerInstaller(
      { ensureProxy: vi.fn(async () => ({ exec }) as never) },
      { resolve: vi.fn() }
    );

    await expect(
      installer.installedVersion('ssh-1', workspaceServerLayout('/home/devuser'))
    ).rejects.toMatchObject({
      code: 'install-failed',
      message: expect.stringContaining('points outside versions/'),
    });
  });
});
