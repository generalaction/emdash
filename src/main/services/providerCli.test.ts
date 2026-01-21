import { describe, expect, it } from 'vitest';
import { buildProviderCliArgs, detectProviderFromShellCommand } from './providerCli';
import { getProvider } from '@shared/providers/registry';

describe('providerCli', () => {
  it('detects provider from Windows shim path', () => {
    const provider = detectProviderFromShellCommand(
      'C:\\\\Users\\\\User\\\\AppData\\\\Roaming\\\\npm\\\\codex.cmd'
    );
    expect(provider?.id).toBe('codex');
  });

  it('detects provider from bare command', () => {
    const provider = detectProviderFromShellCommand('codex');
    expect(provider?.id).toBe('codex');
  });

  it('builds args with auto-approve', () => {
    const provider = getProvider('codex');
    expect(provider).toBeTruthy();
    expect(provider?.autoApproveFlag).toBeTruthy();
    const args = buildProviderCliArgs(provider!, { autoApprove: true });
    expect(args).toContain(provider!.autoApproveFlag!);
  });

  it('includes resume flag unless skipped', () => {
    const provider = getProvider('claude');
    expect(provider).toBeTruthy();

    const args = buildProviderCliArgs(provider!, { skipResume: false });
    expect(args.slice(0, 2)).toEqual(['-c', '-r']);

    const skipped = buildProviderCliArgs(provider!, { skipResume: true });
    expect(skipped).not.toContain('-c');
    expect(skipped).not.toContain('-r');
  });
});
