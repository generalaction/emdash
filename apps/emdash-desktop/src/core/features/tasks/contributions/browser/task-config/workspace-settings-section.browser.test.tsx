import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSettingsSection } from './workspace-settings-section';

const taskState = vi.hoisted(() => ({
  workspaceConfig: {
    presetId: 'new-worktree',
    setPresetId: vi.fn(),
    workspaceOptions: [],
    branchSelection: {
      createBranchAndWorktree: false,
      setCreateBranchAndWorktree: vi.fn(),
    },
  },
  projectId: undefined,
  isUnborn: false,
  hasRepository: true,
  hasPR: false,
}));

vi.mock('@core/features/tasks/browser/task-config/checkout-pr-panel', () => ({
  CheckoutPrPanel: () => null,
}));
vi.mock('@core/features/tasks/browser/task-config/existing-workspace-picker', () => ({
  useProjectWorkspaces: () => ({ data: [] }),
}));
vi.mock('@core/features/tasks/browser/task-config/new-worktree-panel', () => ({
  NewWorktreePanel: () => <div data-testid="new-worktree-panel" />,
}));
vi.mock('@core/features/tasks/browser/task-config/pr-new-branch-panel', () => ({
  PrNewBranchPanel: () => null,
}));
vi.mock('@core/features/tasks/browser/task-config/use-existing-panel', () => ({
  UseExistingPanel: () => null,
}));
vi.mock('@core/features/tasks/browser/task-config/workspace-preset-picker', () => ({
  WorkspacePresetPicker: () => null,
}));
vi.mock('@core/features/tasks/browser/task-config/worktree-destination-preview', () => ({
  WorktreeDestinationPreview: () => null,
}));
vi.mock('@core/features/tasks/contributions/browser/task-config/task-state-context', () => ({
  useTaskState: () => taskState,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('WorkspaceSettingsSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows the branch tabs and branch panel without a collapsible settings toggle', () => {
    act(() => root.render(<WorkspaceSettingsSection />));

    expect(container.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();
    expect(container.querySelector('[data-testid="new-worktree-panel"]')).not.toBeNull();
    expect(container.textContent).toContain('Checkout branch');
    expect(container.textContent).toContain('Create new branch');
  });
});
