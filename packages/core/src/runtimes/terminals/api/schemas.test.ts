import { describe, expect, it } from 'vitest';
import { terminalsContract } from './contract';
import { startTerminalSpecSchema } from './schemas';

/**
 * Protocol negotiation / upgrade-path coverage for the shell-intent migration.
 *
 * The runtime contract dropped the resolved `shellProfile` field in favor of a
 * portable `shellIntent`. Because a desktop app and its workspace-server peer
 * can briefly run different builds during an upgrade, these tests pin the
 * cross-version behavior at the wire schema boundary.
 */
describe('startTerminalSpecSchema shell-intent negotiation', () => {
  it('accepts a spec carrying only shell intent', () => {
    const parsed = startTerminalSpecSchema.parse({
      cwd: '/repo',
      env: {},
      shellIntent: 'zsh',
    });

    expect(parsed.shellIntent).toBe('zsh');
  });

  it('treats a missing shell intent as target-default (older desktop peer)', () => {
    const parsed = startTerminalSpecSchema.parse({ cwd: '/repo', env: {} });

    expect(parsed.shellIntent).toBeUndefined();
  });

  it('drops a legacy resolved shellProfile field instead of failing (older peer payload)', () => {
    const parsed = startTerminalSpecSchema.parse({
      cwd: '/repo',
      env: {},
      shellProfile: {
        id: 'zsh',
        resolvedShellId: 'zsh',
        resolvedFromSystem: false,
        executable: '/bin/zsh',
        family: 'posix',
        interactiveArgs: ['-il'],
        commandArgs: ['-lc'],
      },
    });

    expect(parsed).not.toHaveProperty('shellProfile');
    expect(parsed.shellIntent).toBeUndefined();
  });

  it('rejects an unknown shell intent', () => {
    const result = startTerminalSpecSchema.safeParse({
      cwd: '/repo',
      env: {},
      shellIntent: 'nushell',
    });

    expect(result.success).toBe(false);
  });

  it('exposes a host-agnostic getShellAvailability procedure', () => {
    expect(terminalsContract.getShellAvailability).toBeDefined();
    expect(terminalsContract.getShellAvailability.input.safeParse(undefined).success).toBe(true);
  });
});
