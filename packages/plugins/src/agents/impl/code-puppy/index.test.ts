import type { CommandContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cli: 'code-puppy',
    autoApprove: false,
    isResuming: false,
    model: '',
    ...overrides,
  };
}

function buildArgs(overrides: Partial<CommandContext> = {}): string[] {
  return provider.behavior.prompt!.buildCommand(ctx(overrides)).args;
}

describe('Code Puppy plugin', () => {
  it('declares a terminal-only provider with typed prompts and resumable sessions', () => {
    expect(provider.metadata).toMatchObject({ id: 'code-puppy', name: 'Code Puppy' });
    expect(provider.capabilities.prompt).toEqual({ kind: 'pty-only' });
    expect(provider.capabilities.sessions.kind).toBe('resumable');
    expect(provider.capabilities.acp.kind).toBe('none');
    expect(provider.capabilities.autoApprove.kind).toBe('none');
    expect(provider.capabilities.hooks.kind).toBe('none');
    expect(provider.capabilities.mcp.kind).toBe('none');
    expect(provider.capabilities.trust.kind).toBe('none');
    expect(provider.validate()).toEqual([]);
  });

  it('probes both Code Puppy commands, installs with uv, and self-updates', () => {
    const dependency = provider.capabilities.hostDependency;

    expect(dependency.binaryNames).toEqual(['code-puppy', 'pup']);
    expect(dependency.updateCommand).toEqual({ kind: 'self', args: ['update'] });
    for (const platform of ['macos', 'linux'] as const) {
      expect(dependency.installCommands?.[platform]).toEqual([
        expect.objectContaining({
          method: 'other',
          command: 'uv tool install code-puppy',
          uninstallCommand: 'uv tool uninstall code-puppy',
          recommended: true,
        }),
      ]);
    }
  });
});

describe('Code Puppy terminal command', () => {
  it('starts the interactive TUI without putting the prompt in argv', () => {
    expect(buildArgs()).toEqual([]);
    expect(buildArgs({ initialPrompt: 'fix the build', sessionId: 'conv-1' })).toEqual([]);
  });

  it('passes the selected model and user extra args', () => {
    expect(buildArgs({ model: 'openai:gpt-5', extraArgs: ['--request-limit', '50'] })).toEqual([
      '--model',
      'openai:gpt-5',
      '--request-limit',
      '50',
    ]);
  });

  it('continues the most recent session of the worktree on resume', () => {
    expect(buildArgs({ isResuming: true, sessionId: 'conv-1' })).toEqual(['--continue']);
  });
});
