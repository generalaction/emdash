import { describe, expect, it } from 'vitest';
import type { ProviderCustomConfig } from '@shared/app-settings';
import {
  buildClaudeExecCommand,
  buildCodexExecCommand,
  buildPiExecCommand,
  isClaudeSessionId,
  isCodexThreadId,
  isPiThinkingLevel,
} from './native-exec-command';

const CODEX_CONFIG: ProviderCustomConfig = {
  cli: 'codex',
  autoApproveFlag:
    '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
};

const THREAD_ID = '019e966e-a5fc-7600-a34d-624266ca1dca';
const CLAUDE_SESSION_ID = '49df8b52-4204-4043-93c8-3eaca858922a';

const CLAUDE_CONFIG: ProviderCustomConfig = {
  cli: 'claude',
  autoApproveFlag: '--dangerously-skip-permissions',
};

const PI_CONFIG: ProviderCustomConfig = {
  cli: 'pi',
  defaultArgs: ['--provider', 'openai'],
  extraArgs: '--no-themes',
};

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

describe('buildClaudeExecCommand', () => {
  it('builds a stream-json print turn with acceptEdits by default', () => {
    const { command, args } = buildClaudeExecCommand({
      providerConfig: CLAUDE_CONFIG,
      prompt: 'do the thing',
    });
    expect(command).toBe('claude');
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      'do the thing',
    ]);
  });

  it('resumes a session and applies the auto-approve flag', () => {
    const { args } = buildClaudeExecCommand({
      providerConfig: CLAUDE_CONFIG,
      autoApprove: true,
      resumeSessionId: CLAUDE_SESSION_ID,
      prompt: 'continue',
    });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(CLAUDE_SESSION_ID);
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--permission-mode');
    expect(args[args.length - 1]).toBe('continue');
  });

  it('preserves configured provider arguments before print-mode flags', () => {
    const { command, args } = buildClaudeExecCommand({
      providerConfig: {
        ...CLAUDE_CONFIG,
        cli: 'env CLAUDE_CONFIG_DIR=/tmp/claude claude',
        defaultArgs: ['--settings', 'team'],
        extraArgs: '--debug',
      },
      prompt: 'go',
    });
    expect(command).toBe('env');
    expect(args.slice(0, 5)).toEqual([
      'CLAUDE_CONFIG_DIR=/tmp/claude',
      'claude',
      '--settings',
      'team',
      '--debug',
    ]);
    expect(args[5]).toBe('-p');
  });

  it('passes the model and effort as flags before the prompt', () => {
    const { args } = buildClaudeExecCommand({
      providerConfig: CLAUDE_CONFIG,
      model: 'opus',
      reasoningEffort: 'max',
      prompt: 'go',
    });
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--effort') + 1]).toBe('max');
    expect(args[args.length - 1]).toBe('go');
  });

  it('rejects unsafe model ids', () => {
    expect(() =>
      buildClaudeExecCommand({
        providerConfig: CLAUDE_CONFIG,
        model: 'opus; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid model id/);
  });

  it('rejects non-UUID resume ids', () => {
    expect(() =>
      buildClaudeExecCommand({
        providerConfig: CLAUDE_CONFIG,
        resumeSessionId: '--resume; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid Claude session id/);
  });
});

describe('isClaudeSessionId', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isClaudeSessionId(CLAUDE_SESSION_ID)).toBe(true);
    expect(isClaudeSessionId('claude-session')).toBe(false);
  });
});

describe('buildPiExecCommand', () => {
  it('builds a JSON print turn with a deterministic session id', () => {
    const { command, args } = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: '0dc5c1e2-f008-4594-a9b6-694037bedc88',
      prompt: 'do the thing',
    });
    expect(command).toBe('pi');
    expect(args).toEqual([
      '--provider',
      'openai',
      '--no-themes',
      '--mode',
      'json',
      '--print',
      '--session-id',
      '0dc5c1e2-f008-4594-a9b6-694037bedc88',
      'do the thing',
    ]);
  });

  it('passes supported thinking levels and drops unsupported native-chat efforts', () => {
    const high = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      reasoningEffort: 'high',
      prompt: 'go',
    });
    expect(high.args).toContain('--thinking');
    expect(high.args[high.args.indexOf('--thinking') + 1]).toBe('high');

    const max = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      reasoningEffort: 'max',
      prompt: 'go',
    });
    expect(max.args).not.toContain('--thinking');
  });

  it('honors a custom cli prefix and rejects unsafe model ids', () => {
    const { command, args } = buildPiExecCommand({
      providerConfig: { ...PI_CONFIG, cli: 'npx @mariozechner/pi-coding-agent' },
      sessionId: 'session',
      model: 'gpt-5.4-mini',
      prompt: 'hi',
    });
    expect(command).toBe('npx');
    expect(args[0]).toBe('@mariozechner/pi-coding-agent');
    expect(args).toContain('gpt-5.4-mini');

    const providerQualified = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      model: 'openai/gpt-4o',
      prompt: 'hi',
    });
    expect(providerQualified.args).toContain('openai/gpt-4o');

    const thinkingAlias = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      model: 'sonnet:high',
      prompt: 'hi',
    });
    expect(thinkingAlias.args).toContain('sonnet:high');

    expect(() =>
      buildPiExecCommand({
        providerConfig: PI_CONFIG,
        sessionId: 'session',
        model: 'bad model; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid model id/);
  });
});

describe('isPiThinkingLevel', () => {
  it('accepts Pi thinking levels used by the native menu', () => {
    expect(isPiThinkingLevel('low')).toBe(true);
    expect(isPiThinkingLevel('xhigh')).toBe(true);
    expect(isPiThinkingLevel('max')).toBe(false);
  });
});
