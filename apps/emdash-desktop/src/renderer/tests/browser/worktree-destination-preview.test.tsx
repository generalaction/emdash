import '@emdash/ui/style.css';
import { compileWorktreePayload } from '@emdash/core/runtimes/workspace-registry/api';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EffectiveSettingsInputs } from '@core/features/projects/api/browser/effective-settings/use-effective-settings';
import { WorktreeDestinationPreviewView } from '@core/features/tasks/browser/task-config/worktree-destination-preview';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const PROJECT_PATH = '/home/me/repositories/emdash';

function makeInputs(overrides: Partial<EffectiveSettingsInputs> = {}): EffectiveSettingsInputs {
  return {
    storedGitSettings: {},
    repoFacts: {
      remotes: [{ name: 'origin', host: 'github.com', headBranch: 'main', branches: ['main'] }],
      localBranches: ['main'],
    },
    accounts: [],
    placementContext: {
      hostWorktreeRoot: null,
      builtInWorktreeRoot: '/home/me/emdash/worktrees',
      homeDirectory: '/home/me',
      hostTmux: null,
      appDefaultTmux: false,
    },
    ...overrides,
  };
}

function newWorktreeConfig(branchName: string): WorkspaceConfig {
  return {
    version: '2',
    git: {
      kind: 'create-branch',
      branchName,
      fromBranch: { type: 'local', branch: 'main' },
      pushBranch: false,
    },
    workspace: { kind: 'new-worktree' },
  };
}

describe('WorktreeDestinationPreviewView', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows the destination execution derives for the resolved worktree root', async () => {
    await act(async () => {
      root.render(
        <WorktreeDestinationPreviewView
          inputs={makeInputs()}
          projectPath={PROJECT_PATH}
          workspaceConfig={newWorktreeConfig('feature/x')}
        />
      );
    });

    // The invariant: the preview shows exactly the path the execution
    // derivation produces over the same resolver output.
    const expected = compileWorktreePayload({
      repoPath: PROJECT_PATH,
      worktreeRoot: '/home/me/emdash/worktrees',
      branchName: 'feature/x',
    }).worktreePath;
    expect(host.textContent).toContain('Worktree:');
    expect(host.textContent).toContain(expected);
  });

  it('prefers a usable per-project override root', async () => {
    await act(async () => {
      root.render(
        <WorktreeDestinationPreviewView
          inputs={makeInputs({ storedGitSettings: { worktreeRoot: '~/fast-pool' } })}
          projectPath={PROJECT_PATH}
          workspaceConfig={newWorktreeConfig('feature/x')}
        />
      );
    });

    expect(host.textContent).toContain('/home/me/fast-pool/');
    expect(host.textContent).not.toContain('is not usable');
  });

  it('degrades a broken configured root with a visible warning, never blocking', async () => {
    await act(async () => {
      root.render(
        <WorktreeDestinationPreviewView
          inputs={makeInputs({ storedGitSettings: { worktreeRoot: 'relative/never-works' } })}
          projectPath={PROJECT_PATH}
          workspaceConfig={newWorktreeConfig('feature/x')}
        />
      );
    });

    // Destination still resolves (to the built-in layer) and the warning names
    // the stale value and the fallback.
    expect(host.textContent).toContain('/home/me/emdash/worktrees/');
    expect(host.textContent).toContain("'relative/never-works' is not usable");
    expect(host.textContent).toContain('/home/me/emdash/worktrees');
  });

  it('renders nothing when the config does not create a new worktree', async () => {
    const config: WorkspaceConfig = {
      version: '2',
      git: { kind: 'none' },
      workspace: { kind: 'repository-instance', workspaceId: 'ws-1' },
    };
    await act(async () => {
      root.render(
        <WorktreeDestinationPreviewView
          inputs={makeInputs()}
          projectPath={PROJECT_PATH}
          workspaceConfig={config}
        />
      );
    });

    expect(host.textContent).toBe('');
  });
});
