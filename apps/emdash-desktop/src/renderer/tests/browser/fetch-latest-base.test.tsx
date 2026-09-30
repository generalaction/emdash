import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { WorkspaceConfigState } from '@core/features/tasks/api/browser/create-task-modal/use-workspace-config';
import { NewWorktreePanel } from '@core/features/tasks/browser/task-config/new-worktree-panel';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('fetch latest base creation control', () => {
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

  function config(canFetchLatestBase: boolean): WorkspaceConfigState {
    // The panel consumes this projection of the form's state; the hook is covered separately.
    return {
      branchSelection: { createBranchAndWorktree: true },
      branchNameState: {
        branchName: 'feature/task',
        setBranchName: vi.fn(),
        branchAlreadyExists: false,
      },
      branchConflict: null,
      fetchLatestBase: false,
      canFetchLatestBase,
      setFetchLatestBase: vi.fn(),
    } as unknown as WorkspaceConfigState;
  }

  it('lets the user enable the option for a remote base', async () => {
    const state = config(true);
    await act(async () => root.render(<NewWorktreePanel workspaceConfig={state} />));
    const checkbox = page.getByRole('checkbox', { name: 'Fetch latest base before creation' });
    await expect.element(checkbox).not.toHaveAttribute('aria-disabled', 'true');
    await act(async () => checkbox.click());
    expect(state.setFetchLatestBase).toHaveBeenCalledWith(true);
    expect(host.textContent).toContain('Creation stops if the fetch fails.');
  });

  it('disables the option and explains how to enable it for a local base', async () => {
    const state = config(false);
    await act(async () => root.render(<NewWorktreePanel workspaceConfig={state} />));
    const checkbox = page.getByRole('checkbox', { name: 'Fetch latest base before creation' });
    await expect.element(checkbox).toHaveAttribute('aria-disabled', 'true');
    expect(host.textContent).toContain('Select a remote base branch');
    expect(state.setFetchLatestBase).not.toHaveBeenCalled();
  });
});
