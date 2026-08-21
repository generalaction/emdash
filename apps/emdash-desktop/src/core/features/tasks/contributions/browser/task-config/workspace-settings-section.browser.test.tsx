import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSettingsSection } from './workspace-settings-section';

const taskState = vi.hoisted(() => ({
  workspaceConfig: {
    presetId: 'new-worktree',
    setPresetId: vi.fn(),
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
  NewWorktreePanel: () => null,
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

describe('WorkspaceSettingsSection layout', () => {
  let container: HTMLDivElement;
  let root: Root;
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = `
      @layer utilities {
        .flex { display: flex; }
        .grid { display: grid; }
        .flex-col { flex-direction: column; }
        .h-9 { height: 2.25rem; }
        .w-full { width: 100%; }
        .items-center { align-items: center; }
        .justify-between { justify-content: space-between; }
        .gap-2 { gap: 0.5rem; }
        .ml-auto { margin-left: auto; }
        [class~='grid-cols-[minmax(0,1fr)_auto]'] {
          grid-template-columns: minmax(0, 1fr) auto;
        }
      }
    `;
    document.head.append(style);

    container = document.createElement('div');
    container.style.width = '480px';
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    style.remove();
  });

  it('allocates an intrinsic column to the branch tabs without overflowing', () => {
    act(() => root.render(<WorkspaceSettingsSection defaultOpen={false} />));

    const trigger = container.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    const header = trigger?.parentElement;

    expect(trigger).not.toBeNull();
    expect(header).not.toBeNull();
    expect(getComputedStyle(header!).display).toBe('grid');
    expect(header!.scrollWidth).toBeLessThanOrEqual(header!.clientWidth);
  });
});
