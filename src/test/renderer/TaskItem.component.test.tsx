import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskItem } from '../../renderer/components/TaskItem';

vi.mock('../../renderer/hooks/useTaskChanges', () => ({
  useTaskChanges: () => ({
    totalAdditions: 0,
    totalDeletions: 0,
    isLoading: false,
  }),
}));

vi.mock('../../renderer/hooks/usePrStatus', () => ({
  usePrStatus: () => ({
    pr: null,
  }),
}));

vi.mock('../../renderer/hooks/useTaskBusy', () => ({
  useTaskBusy: () => false,
}));

vi.mock('../../renderer/hooks/useTaskStatus', () => ({
  useTaskStatus: () => 'idle',
}));

vi.mock('../../renderer/hooks/useTaskUnread', () => ({
  useTaskUnread: () => false,
}));

vi.mock('../../renderer/components/TaskChanges', () => ({
  ChangesBadge: () => <div data-testid="changes-badge" />,
}));

vi.mock('../../renderer/components/PrPreviewTooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../renderer/components/TaskStatusIndicator', () => ({
  TaskStatusIndicator: () => <div data-testid="task-status-indicator" />,
}));

vi.mock('../../renderer/components/TaskDeleteButton', () => ({
  default: () => null,
}));

vi.mock('../../renderer/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

const task = {
  id: 'task-1',
  name: 'initial-task-name',
  branch: 'emdash/initial-task-name-abc123',
  path: '/tmp/task-1',
  status: 'idle' as const,
};

function renderTaskItem(onRename = vi.fn()) {
  render(<TaskItem task={task} onRename={onRename} />);
  return { onRename };
}

async function startEditing() {
  fireEvent.doubleClick(screen.getByText(task.name));
  const input = await screen.findByRole('textbox', { name: `Rename task ${task.name}` });
  await waitFor(() => expect(input).toHaveFocus());
  return input;
}

describe('TaskItem', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enters inline edit mode on task name double-click', async () => {
    renderTaskItem();

    const input = await startEditing();

    expect(input).toHaveValue(task.name);
  });

  it('submits the normalized task name on Enter', async () => {
    const { onRename } = renderTaskItem();
    const input = await startEditing();

    fireEvent.change(input, { target: { value: ' Fix Login Flow !! ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('fix-login-flow'));
    expect(
      screen.queryByRole('textbox', { name: `Rename task ${task.name}` })
    ).not.toBeInTheDocument();
  });

  it('cancels inline editing on Escape', async () => {
    const { onRename } = renderTaskItem();
    const input = await startEditing();

    fireEvent.change(input, { target: { value: 'another-name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('textbox', { name: `Rename task ${task.name}` })
    ).not.toBeInTheDocument();
    expect(screen.getByText(task.name)).toBeInTheDocument();
  });

  it('does not submit an unchanged name', async () => {
    const { onRename } = renderTaskItem();
    const input = await startEditing();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(
        screen.queryByRole('textbox', { name: `Rename task ${task.name}` })
      ).not.toBeInTheDocument();
    });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not submit an invalid blank name', async () => {
    const { onRename } = renderTaskItem();
    const input = await startEditing();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(
        screen.queryByRole('textbox', { name: `Rename task ${task.name}` })
      ).not.toBeInTheDocument();
    });
    expect(onRename).not.toHaveBeenCalled();
  });
});
