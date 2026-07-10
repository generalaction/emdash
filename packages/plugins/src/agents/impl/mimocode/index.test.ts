import type { CommandContext } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { pluginRegistry } from '../../registry';

const mimocode = pluginRegistry.get('mimocode')!;

function build(ctx: CommandContext) {
  return mimocode.behavior.prompt!.buildCommand(ctx);
}

describe('mimocode plugin', () => {
  it('registers the native installer as recommended with npm as a fallback', () => {
    expect(mimocode.metadata.websiteUrl).toBe('https://github.com/XiaomiMiMo/MiMo-Code');
    expect(mimocode.capabilities.hostDependency.binaryNames).toEqual(['mimo']);
    expect(mimocode.capabilities.hostDependency.installCommands).toMatchObject({
      macos: [
        { method: 'npm', command: 'npm install -g @mimo-ai/cli' },
        {
          method: 'curl',
          command: 'curl -fsSL https://mimo.xiaomi.com/install | bash',
          recommended: true,
        },
      ],
      linux: [
        { method: 'npm', command: 'npm install -g @mimo-ai/cli' },
        {
          method: 'curl',
          command: 'curl -fsSL https://mimo.xiaomi.com/install | bash',
          recommended: true,
        },
      ],
      windows: [
        { method: 'npm', command: 'npm install -g @mimo-ai/cli' },
        {
          method: 'powershell',
          command: 'powershell -ep Bypass -c "irm https://mimo.xiaomi.com/install.ps1 | iex"',
          recommended: true,
        },
      ],
    });
    expect(mimocode.capabilities.hostDependency.installCommands.macos?.[0]?.recommended).toBe(
      undefined
    );
    expect(mimocode.capabilities.hostDependency.updates).toMatchObject({
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@mimo-ai/cli' },
    });
  });

  it('delivers a fresh prompt via --prompt and auto-approves via env, not a flag', () => {
    const result = build({
      cli: 'mimo',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });

    expect(result.command).toBe('mimo');
    // The interactive `mimo` TUI only accepts --prompt / -c / -s / --fork /
    // --model / --agent / --never-ask-questions. Unknown flags like `--trust`
    // or `--dangerously-skip-permissions` (run-only) make it print usage.
    expect(result.args).toEqual(['--prompt', 'Fix the bug']);
    expect(result.args).not.toContain('--dangerously-skip-permissions');
    expect(result.args).not.toContain('--trust');
    expect(result.env).toEqual({ MIMOCODE_PERMISSION: '{"*":"allow"}' });
  });

  it('omits the permission env when auto-approve is disabled', () => {
    const result = build({
      cli: 'mimo',
      autoApprove: false,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });

    expect(result.args).toEqual(['--prompt', 'Fix the bug']);
    expect(result.env).toEqual({});
  });

  it('resumes with the stored native session id via --session', () => {
    const result = build({
      cli: 'mimo',
      autoApprove: true,
      initialPrompt: '',
      sessionId: 'conv-1',
      providerSessionId: 'ses_abc123',
      isResuming: true,
      model: '',
    });

    expect(result.args).toEqual(['--session', 'ses_abc123']);
    expect(result.env).toEqual({ MIMOCODE_PERMISSION: '{"*":"allow"}' });
  });

  it('falls back to --continue when only the emdash UUID is available on resume', () => {
    const result = build({
      cli: 'mimo',
      autoApprove: true,
      initialPrompt: '',
      sessionId: 'conv-1',
      // Seeded emdash conversation UUID — must NOT be passed as a --session value.
      providerSessionId: '6fac6620-9fa8-4604-b7e0-1fe361589104',
      isResuming: true,
      model: '',
    });

    expect(result.args).toEqual(['--continue']);
    expect(result.args).not.toContain('6fac6620-9fa8-4604-b7e0-1fe361589104');
  });
});
