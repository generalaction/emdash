import type { CommandContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { pluginRegistry } from '../../registry';

const zero = pluginRegistry.get('zero')!;

function build(ctx: CommandContext) {
  return zero.behavior.prompt!.buildCommand(ctx);
}

describe('zero plugin', () => {
  it('registers install metadata and binary name', () => {
    expect(zero).toBeDefined();
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
    expect(zero.capabilities.autoApprove.kind).toBe('supported');
  });

  it('starts the TUI in unsafe mode and leaves prompt delivery to keystroke injection', () => {
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
    expect(result.args).toEqual(['--skip-permissions-unsafe']);
    expect(result.env).toEqual({});
  });

  it('does not enable unsafe mode when auto-approve is disabled', () => {
    const result = build({
      cli: 'zero',
      autoApprove: false,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });

    expect(result.args).toEqual([]);
  });
});
