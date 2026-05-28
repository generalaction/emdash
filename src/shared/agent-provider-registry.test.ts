import { describe, expect, it } from 'vitest';
import { supportsChatUi, type AgentProviderId } from './agent-provider-registry';

describe('supportsChatUi', () => {
  it('returns true only for providers explicitly marked non-terminal-only', () => {
    expect(supportsChatUi('codex')).toBe(true);
    expect(supportsChatUi('grok')).toBe(false);
    expect(supportsChatUi('unknown-provider' as AgentProviderId)).toBe(false);
  });
});
