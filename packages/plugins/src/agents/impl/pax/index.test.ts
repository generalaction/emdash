import type { CommandContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cli: 'pax',
    autoApprove: false,
    isResuming: false,
    model: '',
    ...overrides,
  };
}

function buildArgs(overrides: Partial<CommandContext> = {}): string[] {
  return provider.behavior.prompt!.buildCommand(ctx(overrides)).args;
}

describe('Pax plugin', () => {
  it('declares a terminal-only provider with typed prompts and resumable sessions', () => {
    expect(provider.metadata).toMatchObject({ id: 'pax', name: 'Pax' });
    expect(provider.capabilities.prompt).toEqual({ kind: 'pty-only' });
    expect(provider.capabilities.sessions.kind).toBe('resumable');
    expect(provider.capabilities.acp.kind).toBe('none');
    expect(provider.capabilities.autoApprove.kind).toBe('none');
    expect(provider.capabilities.hooks.kind).toBe('none');
    expect(provider.capabilities.mcp.kind).toBe('none');
    expect(provider.capabilities.trust.kind).toBe('none');
    expect(provider.validate()).toEqual([]);
  });

  it('probes the pax binary, installs it with uv, and self-updates', () => {
    const dependency = provider.capabilities.hostDependency;

    expect(dependency.binaryNames).toEqual(['pax']);
    expect(dependency.updateCommand).toEqual({ kind: 'self', args: ['update'] });
    for (const platform of ['macos', 'linux'] as const) {
      expect(dependency.installCommands?.[platform]).toEqual([
        expect.objectContaining({
          method: 'other',
          command: 'uv tool install pydantic-ai-pax',
          uninstallCommand: 'uv tool uninstall pydantic-ai-pax',
          recommended: true,
        }),
      ]);
    }
  });
});

describe('Pax terminal command', () => {
  it('starts the interactive TUI without putting the prompt in argv', () => {
    expect(buildArgs()).toEqual([]);
    // `pax <text>` is not a prompt and `-p` runs headless, so the prompt must never reach argv.
    expect(buildArgs({ initialPrompt: 'fix the build', sessionId: 'conv-1' })).toEqual([]);
    expect(buildArgs({ autoApprove: true })).toEqual([]);
  });

  it('passes the selected model and user extra args', () => {
    expect(buildArgs({ model: 'anthropic:claude-sonnet-4-5', extraArgs: ['-x', 'herdr'] })).toEqual(
      ['--model', 'anthropic:claude-sonnet-4-5', '-x', 'herdr']
    );
  });

  it('continues the most recent session of the worktree on resume', () => {
    expect(buildArgs({ isResuming: true })).toEqual(['--continue']);
    // The Emdash conversation id is never passed to `--resume`: Pax exits for an unsaved id.
    expect(
      buildArgs({ isResuming: true, sessionId: 'conv-1', providerSessionId: 'native-1' })
    ).toEqual(['--continue']);
  });
});
