import { describe, expect, it, vi } from 'vitest';
import { canExposeClaudeBypassPermissions } from './claude-permission-mode-capability';

const supportedVersion = '2.1.220 (Claude Code)\n';

function execWith(
  implementation: (command: string, args?: string[]) => Promise<{ stdout: string; stderr: string }>
) {
  return { exec: vi.fn(implementation) };
}

describe('canExposeClaudeBypassPermissions', () => {
  it('enables the switch for a non-root local host with a supporting CLI', async () => {
    const ctx = execWith(async () => ({ stdout: supportedVersion, stderr: '' }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: '/usr/local/bin/claude',
        ctx,
        host: { kind: 'local', platform: 'linux', uid: 1000 },
      })
    ).resolves.toBe(true);
    expect(ctx.exec).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      ['--version'],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('does not probe or enable the switch for a local root process', async () => {
    const ctx = execWith(async () => ({ stdout: supportedVersion, stderr: '' }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx,
        host: { kind: 'local', platform: 'linux', uid: 0 },
      })
    ).resolves.toBe(false);
    expect(ctx.exec).not.toHaveBeenCalled();
  });

  it('allows Windows hosts to use the CLI capability probe without a POSIX uid', async () => {
    const ctx = execWith(async () => ({ stdout: '', stderr: supportedVersion }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude.exe',
        ctx,
        host: { kind: 'local', platform: 'win32', uid: undefined },
      })
    ).resolves.toBe(true);
  });

  it('fails closed when the local uid or CLI version cannot be confirmed', async () => {
    const missingUidCtx = execWith(async () => ({ stdout: supportedVersion, stderr: '' }));
    const oldCliCtx = execWith(async () => ({
      stdout: '2.0.25 (Claude Code)',
      stderr: '',
    }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx: missingUidCtx,
        host: { kind: 'local', platform: 'darwin', uid: undefined },
      })
    ).resolves.toBe(false);
    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx: oldCliCtx,
        host: { kind: 'local', platform: 'darwin', uid: 501 },
      })
    ).resolves.toBe(false);
  });

  it.each([
    { version: '2.0.25 (Claude Code)', expected: false },
    { version: '2.0.26 (Claude Code)', expected: true },
    { version: '3.0.0 (Claude Code)', expected: true },
    { version: '2.0.26-beta.1 (Claude Code)', expected: false },
    { version: 'unknown', expected: false },
  ])('maps Claude $version support to $expected', async ({ version, expected }) => {
    const ctx = execWith(async () => ({ stdout: version, stderr: '' }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx,
        host: { kind: 'local', platform: 'linux', uid: 1000 },
      })
    ).resolves.toBe(expected);
  });

  it('fails closed when warnings make the version output ambiguous', async () => {
    const ctx = execWith(async () => ({
      stdout: '2.1.220 (Claude Code)',
      stderr: 'Node.js 99.0.0 warning',
    }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx,
        host: { kind: 'local', platform: 'linux', uid: 1000 },
      })
    ).resolves.toBe(false);
  });

  it('enables the switch for a confirmed non-root SSH host with a supporting CLI', async () => {
    const ctx = execWith(async (command) =>
      command === 'id' ? { stdout: '1000\n', stderr: '' } : { stdout: supportedVersion, stderr: '' }
    );

    await expect(
      canExposeClaudeBypassPermissions({
        cli: '/home/user/.local/bin/claude',
        ctx,
        host: { kind: 'ssh' },
      })
    ).resolves.toBe(true);
    expect(ctx.exec).toHaveBeenCalledWith(
      'id',
      ['-u'],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(ctx.exec).toHaveBeenCalledWith(
      '/home/user/.local/bin/claude',
      ['--version'],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    { name: 'root', uid: '0\n' },
    { name: 'malformed uid', uid: 'unknown\n' },
    { name: 'unsafe integer uid', uid: '999999999999999999999\n' },
  ])('fails closed for an SSH $name response', async ({ uid }) => {
    const ctx = execWith(async () => ({ stdout: uid, stderr: '' }));

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx,
        host: { kind: 'ssh' },
      })
    ).resolves.toBe(false);
    expect(ctx.exec).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an SSH uid or CLI version probe errors', async () => {
    const uidErrorCtx = execWith(async () => {
      throw new Error('connection lost');
    });
    const versionErrorCtx = execWith(async (command) => {
      if (command === 'id') return { stdout: '1000\n', stderr: '' };
      throw new Error('version probe failed');
    });

    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx: uidErrorCtx,
        host: { kind: 'ssh' },
      })
    ).resolves.toBe(false);
    await expect(
      canExposeClaudeBypassPermissions({
        cli: 'claude',
        ctx: versionErrorCtx,
        host: { kind: 'ssh' },
      })
    ).resolves.toBe(false);
  });
});
