import { describe, expect, it } from 'vitest';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { buildCodexExecCommand, isCodexThreadId } from './codex-exec-command';

const CODEX_CONFIG: ProviderCustomConfig = {
  cli: 'codex',
  autoApproveFlag:
    '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
};

const THREAD_ID = '019e966e-a5fc-7600-a34d-624266ca1dca';

describe('buildCodexExecCommand', () => {
  it('builds a sandboxed fresh turn by default', () => {
    const { command, args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      prompt: 'do the thing',
    });
    expect(command).toBe('codex');
    expect(args).toEqual([
      'exec',
      '--json',
      '-c',
      'sandbox_mode=workspace-write',
      '--dangerously-bypass-hook-trust',
      'do the thing',
    ]);
  });

  it('resumes a thread for follow-up turns', () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      resumeThreadId: THREAD_ID,
      prompt: 'continue',
    });
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', THREAD_ID]);
    expect(args).toContain('--json');
    expect(args[args.length - 1]).toBe('continue');
  });

  it('applies the configured auto-approve flags', () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      autoApprove: true,
      prompt: 'go',
    });
    expect(args).toEqual([
      'exec',
      '--json',
      '-c',
      'approval_policy=never',
      '-c',
      'sandbox_mode=danger-full-access',
      '--dangerously-bypass-hook-trust',
      'go',
    ]);
  });

  it('preserves configured provider arguments before the exec subcommand', () => {
    const { command, args } = buildCodexExecCommand({
      providerConfig: {
        ...CODEX_CONFIG,
        cli: 'env CODEX_PROFILE=work codex',
        defaultArgs: ['--config-profile', 'team'],
        extraArgs: '--experimental-flag "quoted value"',
      },
      prompt: 'go',
    });
    expect(command).toBe('env');
    expect(args.slice(0, 6)).toEqual([
      'CODEX_PROFILE=work',
      'codex',
      '--config-profile',
      'team',
      '--experimental-flag',
      'quoted value',
    ]);
    expect(args[6]).toBe('exec');
  });

  it('passes the reasoning effort as a config override before the prompt', () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      reasoningEffort: 'high',
      prompt: 'go',
    });
    const index = args.indexOf('model_reasoning_effort=high');
    expect(index).toBeGreaterThan(0);
    expect(args[index - 1]).toBe('-c');
    expect(args[args.length - 1]).toBe('go');
  });

  it('passes the model via -m and rejects unsafe ids', () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      model: 'gpt-5.4-mini',
      prompt: 'go',
    });
    const index = args.indexOf('-m');
    expect(index).toBeGreaterThan(0);
    expect(args[index + 1]).toBe('gpt-5.4-mini');

    expect(() =>
      buildCodexExecCommand({
        providerConfig: CODEX_CONFIG,
        model: 'bad model; rm -rf /',
        prompt: 'go',
      })
    ).toThrow(/Invalid model id/);
  });

  it("drops reasoning efforts outside Codex's set instead of passing them", () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      reasoningEffort: 'max',
      prompt: 'go',
    });
    expect(args.some((arg) => arg.includes('model_reasoning_effort'))).toBe(false);
  });

  it('passes the speed (service tier) as a config override', () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      serviceTier: 'priority',
      prompt: 'go',
    });
    const index = args.indexOf('service_tier=priority');
    expect(index).toBeGreaterThan(0);
    expect(args[index - 1]).toBe('-c');
  });

  it('passes image attachments via -i before the prompt', () => {
    const { args } = buildCodexExecCommand({
      providerConfig: CODEX_CONFIG,
      images: ['/tmp/a.png', '/tmp/b.png'],
      prompt: 'look',
    });
    const first = args.indexOf('-i');
    expect(args[first + 1]).toBe('/tmp/a.png');
    expect(args[args.lastIndexOf('-i') + 1]).toBe('/tmp/b.png');
    expect(args[args.length - 1]).toBe('look');

    expect(() =>
      buildCodexExecCommand({ providerConfig: CODEX_CONFIG, images: [''], prompt: 'x' })
    ).toThrow(/Invalid image path/);
  });

  it('rejects non-UUID resume ids', () => {
    expect(() =>
      buildCodexExecCommand({
        providerConfig: CODEX_CONFIG,
        resumeThreadId: 'resume --last; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid Codex thread id/);
  });

  it('honors a custom cli prefix', () => {
    const { command, args } = buildCodexExecCommand({
      providerConfig: { ...CODEX_CONFIG, cli: 'npx @openai/codex' },
      prompt: 'hi',
    });
    expect(command).toBe('npx');
    expect(args[0]).toBe('@openai/codex');
    expect(args[1]).toBe('exec');
  });
});

describe('isCodexThreadId', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isCodexThreadId(THREAD_ID)).toBe(true);
    expect(isCodexThreadId('codex-session')).toBe(false);
    expect(isCodexThreadId('')).toBe(false);
  });
});
