import { describe, expect, it, vi } from 'vitest';
import { workspaceServerLayout } from '../layout';
import { buildWorkspaceServerInstallCommand, WorkspaceServerInstaller } from './installer';

describe('workspace-server installer command', () => {
  it('downloads the hosted script to a temporary file before executing it', () => {
    const command = buildWorkspaceServerInstallCommand(
      "file:///opt/emdash artifact's/$(printf injected)"
    );

    expect(command).toContain(
      "curl -fsSL --output \"$install_script\" -- 'file:///opt/emdash%20artifact'\\''s/$(printf%20injected)/install.sh'"
    );
    expect(command).toContain(
      "sh \"$install_script\" --base-url 'file:///opt/emdash%20artifact'\\''s/$(printf%20injected)'"
    );
    expect(command).toContain('if ! curl');
    expect(command).toContain('exit 41');
  });

  it('rejects unsupported install base URL protocols', () => {
    expect(() => buildWorkspaceServerInstallCommand('ftp://releases.example.test')).toThrow(
      expect.objectContaining({ code: 'artifact-download-failed' })
    );
  });

  it('executes the hosted installer through the SSH proxy', async () => {
    const execScript = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const ensureProxy = vi.fn(async () => ({ execScript }) as never);
    const installer = new WorkspaceServerInstaller({ ensureProxy }, 'file:///opt/emdash-artifacts');

    await installer.install('ssh-1');

    expect(ensureProxy).toHaveBeenCalledWith('ssh-1');
    expect(execScript).toHaveBeenCalledWith(
      expect.stringContaining('file:///opt/emdash-artifacts/install.sh'),
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
