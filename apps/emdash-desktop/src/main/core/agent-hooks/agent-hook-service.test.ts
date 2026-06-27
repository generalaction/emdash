import { describe, expect, it, vi } from 'vitest';
import {
  providerSupportsNativeStartHook,
  shouldResetAgentStatusOnSessionExit,
} from './agent-hook-service';

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn((id: string) => ({
    capabilities: {
      hooks:
        id === 'amp'
          ? { kind: 'plugin', scope: 'workspace', supportedEvents: ['start', 'stop', 'session'] }
          : {
              kind: 'config',
              scope: 'global',
              supportedEvents: ['notification', 'stop', 'session'],
            },
    },
  })),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/db/schema', () => ({
  conversations: {
    id: 'id',
    agentStatus: 'agentStatus',
    projectId: 'projectId',
  },
}));

describe('providerSupportsNativeStartHook', () => {
  it('detects providers that emit native start hooks', () => {
    expect(providerSupportsNativeStartHook('amp')).toBe(true);
  });

  it('does not treat other hook support as native start support', () => {
    expect(providerSupportsNativeStartHook('codex')).toBe(false);
  });
});

describe('shouldResetAgentStatusOnSessionExit', () => {
  it('resets statuses that imply a live agent session', () => {
    expect(shouldResetAgentStatusOnSessionExit('working')).toBe(true);
    expect(shouldResetAgentStatusOnSessionExit('awaiting-input')).toBe(true);
  });

  it('keeps terminal and unseen-result statuses intact', () => {
    expect(shouldResetAgentStatusOnSessionExit('idle')).toBe(false);
    expect(shouldResetAgentStatusOnSessionExit('completed')).toBe(false);
    expect(shouldResetAgentStatusOnSessionExit('error')).toBe(false);
    expect(shouldResetAgentStatusOnSessionExit(null)).toBe(false);
  });
});
