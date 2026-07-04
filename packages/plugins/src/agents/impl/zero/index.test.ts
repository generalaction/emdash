import type { CommandContext } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { pluginRegistry } from '../../registry';

const zero = pluginRegistry.get('zero')!;

function build(ctx: CommandContext) {
  return zero.behavior.prompt!.buildCommand(ctx);
}

describe('zero plugin', () => {
  it('registers install metadata and binary name', () => {
    expect(zero.metadata.websiteUrl).toBe('https://zero.gitlawb.com/');
    expect(zero.capabilities.hostDependency.binaryNames).toEqual(['zero']);
    expect(zero.capabilities.hostDependency.installCommands.macos?.[0]?.command).toBe(
      'npm install -g @gitlawb/zero'
    );
    expect(zero.capabilities.hostDependency.updates).toMatchObject({
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@gitlawb/zero' },
    });
    expect(zero.capabilities.mcp.kind).toBe('none');
    expect(zero.capabilities.sessions.kind).toBe('stateless');
  });

  it('starts the TUI and leaves prompt delivery to keystroke injection', () => {
    expect(zero.capabilities.prompt.kind).toBe('keystroke');

    const result = build({
      cli: 'zero',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });

    expect(result.command).toBe('zero');
    expect(result.args).toEqual([]);
    expect(result.env).toEqual({});
  });
});
