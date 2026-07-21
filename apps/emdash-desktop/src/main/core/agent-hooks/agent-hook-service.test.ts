import { describe, expect, it, vi } from 'vitest';
import { providerSupportsNativeStartHook } from './agent-hook-service';

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn((id: string) => ({
    capabilities: {
      hooks:
        id === 'amp'
          ? { kind: 'plugin', scope: 'workspace', supportedEvents: ['start', 'stop', 'session'] }
          : id === 'codex'
            ? {
                kind: 'config',
                scope: 'global',
                supportedEvents: ['start', 'notification', 'stop', 'session'],
              }
            : {
                kind: 'config',
                scope: 'global',
                supportedEvents: ['notification', 'stop', 'session'],
              },
    },
  })),
  isValidProviderId: vi.fn((value: unknown) => typeof value === 'string'),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

describe('providerSupportsNativeStartHook', () => {
  it('detects providers that emit native start hooks', () => {
    expect(providerSupportsNativeStartHook('amp')).toBe(true);
    expect(providerSupportsNativeStartHook('codex')).toBe(true);
  });

  it('does not treat other hook support as native start support', () => {
    expect(providerSupportsNativeStartHook('other')).toBe(false);
  });
});
