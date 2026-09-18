import { describe, expect, it, vi } from 'vitest';
import {
  useEffectiveSettingsInputs,
  resolveRendererEffectiveSettings,
} from './use-effective-settings';

const mocks = vi.hoisted(() => ({
  useAccounts: vi.fn(() => ({ data: undefined, isPending: true })),
  settings: vi.fn(() => ({
    domains: {
      gitIdentity: { stored: {} },
      placement: {
        stored: {},
        layers: { hostWorktreeRoot: '/host/worktrees', builtInWorktreeRoot: '/built-in/worktrees' },
      },
    },
  })),
  repository: vi.fn(() => ({
    loading: false,
    repoFacts: { remotes: [], localBranches: ['main'] },
  })),
}));

vi.mock('@core/features/integrations/api/browser/use-provider-accounts', () => ({
  useAccounts: mocks.useAccounts,
}));
vi.mock('../stores/project-selectors', () => ({ getProjectSettingsStore: mocks.settings }));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: mocks.repository,
}));

describe('Git and placement preview inputs', () => {
  it('resolves placement and Git settings without subscribing to pending account inventory', () => {
    const inputs = useEffectiveSettingsInputs('project-1');
    const effective = inputs ? resolveRendererEffectiveSettings(inputs) : null;
    expect(effective?.worktreeRoot.value).toBe('/host/worktrees');
    expect(effective?.defaultBranch.value).toEqual({ remote: null, branch: 'main' });
    expect(mocks.useAccounts).not.toHaveBeenCalled();
  });
});
