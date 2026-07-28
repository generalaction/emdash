import { describe, expect, it, vi } from 'vitest';
import { workspaceServerLayout } from '../layout';
import {
  buildWorkspaceServerAvailableVersionCommand,
  buildWorkspaceServerInstallCommand,
  WorkspaceServerInstaller,
} from './installer';

describe('workspace-server installer command', () => {
  it('downloads the hosted script to a temporary file before executing it', () => {
    const command = buildWorkspaceServerInstallCommand(
      "http://minio:9000/emdash artifact's/$(printf injected)"
    );

    expect(command).toContain(
      "curl -fsSL --output \"$install_script\" -- 'http://minio:9000/emdash%20artifact'\\''s/$(printf%20injected)/install.sh'"
    );
    expect(command).toContain(
      "sh \"$install_script\" --base-url 'http://minio:9000/emdash%20artifact'\\''s/$(printf%20injected)'"
    );
    expect(command).toContain('if ! curl');
    expect(command).toContain('exit 41');
  });

  it('rejects unsupported install base URL protocols', () => {
    expect(() => buildWorkspaceServerInstallCommand('ftp://releases.example.test')).toThrow(
      expect.objectContaining({ code: 'artifact-download-failed' })
    );
    expect(() => buildWorkspaceServerInstallCommand('file:///opt/emdash-artifacts')).toThrow(
      expect.objectContaining({ code: 'artifact-download-failed' })
    );
  });

  it('builds latest-version commands for hosted artifact URLs', () => {
    expect(
      buildWorkspaceServerAvailableVersionCommand('https://releases.example.test/workspace-server')
    ).toContain('curl -fsSL -- https://releases.example.test/workspace-server/latest.txt');
  });

  it('executes the hosted installer through the SSH proxy', async () => {
    const execScript = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const ensureProxy = vi.fn(async () => ({ execScript }) as never);
    const installer = new WorkspaceServerInstaller(
      { ensureProxy },
      'http://minio:9000/emdash-releases/workspace-server'
    );

    await installer.install('ssh-1');

    expect(ensureProxy).toHaveBeenCalledWith('ssh-1');
    expect(execScript).toHaveBeenCalledWith(
      expect.stringContaining('http://minio:9000/emdash-releases/workspace-server/install.sh'),
      expect.objectContaining({ timeoutMs: 300_000 })
    );
  });

  it('resolves the available version through the SSH proxy', async () => {
    const execScript = vi.fn().mockResolvedValue({
      stdout: '0.1.0-dev.abc123\n',
      stderr: '',
      exitCode: 0,
    });
    const ensureProxy = vi.fn(async () => ({ execScript }) as never);
    const installer = new WorkspaceServerInstaller(
      { ensureProxy },
      'http://minio:9000/emdash-releases/workspace-server'
    );

    await expect(installer.availableVersion('ssh-1')).resolves.toBe('0.1.0-dev.abc123');

    expect(ensureProxy).toHaveBeenCalledWith('ssh-1');
    expect(execScript).toHaveBeenCalledWith(
      expect.stringContaining(
        'curl -fsSL -- http://minio:9000/emdash-releases/workspace-server/latest.txt'
      ),
      expect.objectContaining({ timeoutMs: 10_000 })
    );
  });

  it('rejects invalid available versions', async () => {
    const execScript = vi.fn().mockResolvedValue({
      stdout: 'not a version\n',
      stderr: '',
      exitCode: 0,
    });
    const installer = new WorkspaceServerInstaller({
      ensureProxy: vi.fn(async () => ({ execScript }) as never),
    });

    await expect(installer.availableVersion('ssh-1')).rejects.toMatchObject({
      code: 'artifact-download-failed',
      message: expect.stringContaining('invalid'),
    });
  });

  it('uses a custom install command with substituted placeholders when configured', async () => {
    const execScript = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const installer = new WorkspaceServerInstaller(
      { ensureProxy: vi.fn(async () => ({ execScript }) as never) },
      'http://minio:9000/emdash-releases/workspace-server',
      'curl -fsSL {{scriptUrl}} | sh -s -- --base-url {{baseUrl}}'
    );

    await installer.install('ssh-1');

    expect(execScript).toHaveBeenCalledWith(
      'curl -fsSL http://minio:9000/emdash-releases/workspace-server/install.sh | sh -s -- --base-url http://minio:9000/emdash-releases/workspace-server',
      expect.objectContaining({ timeoutMs: 300_000 })
    );
  });

  it.each([
    [40, 'unsupported-platform'],
    [41, 'artifact-download-failed'],
    [42, 'install-failed'],
  ] as const)('maps installer exit %i to %s', async (exitCode, code) => {
    const execScript = vi.fn().mockResolvedValue({ stdout: '', stderr: 'failed', exitCode });
    const installer = new WorkspaceServerInstaller(
      { ensureProxy: vi.fn(async () => ({ execScript }) as never) },
      'https://releases.example.test/workspace-server'
    );

    await expect(installer.install('ssh-1')).rejects.toMatchObject({ code });
  });

  it('rejects a current link that points outside the managed versions directory', async () => {
    const exec = vi.fn(async () => ({
      stdout: '/tmp/versions/1.2.3\n',
      stderr: '',
      exitCode: 0,
    }));
    const installer = new WorkspaceServerInstaller({
      ensureProxy: vi.fn(async () => ({ exec }) as never),
    });

    await expect(
      installer.installedVersion('ssh-1', workspaceServerLayout('/home/devuser'))
    ).rejects.toMatchObject({
      code: 'install-failed',
      message: expect.stringContaining('points outside versions/'),
    });
  });
});
