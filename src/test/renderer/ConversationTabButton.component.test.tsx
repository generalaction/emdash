import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConversationTabButton } from '../../renderer/components/ChatInterface';

vi.mock('../../renderer/hooks/useConversationStatus', () => ({
  useConversationStatus: () => 'idle',
}));

vi.mock('../../renderer/hooks/useStatusUnread', () => ({
  useStatusUnread: () => false,
}));

vi.mock('../../renderer/components/AgentLogo', () => ({
  default: () => <div data-testid="agent-logo" />,
}));

vi.mock('../../renderer/components/TaskStatusIndicator', () => ({
  TaskStatusIndicator: () => <div data-testid="task-status-indicator" />,
}));

vi.mock('../../renderer/lib/agentConfig', () => ({
  agentConfig: {
    codex: {
      name: 'Codex',
      logo: '<svg></svg>',
      alt: 'Codex',
      isSvg: true,
    },
  },
}));

const conversation = {
  id: 'conv-1',
  taskId: 'task-1',
  title: 'Codex',
  provider: 'codex',
  isMain: true,
  createdAt: '2026-04-02T00:00:00.000Z',
  updatedAt: '2026-04-02T00:00:00.000Z',
};

function renderConversationTabButton() {
  const onSwitchChat = vi.fn();
  const onCloseChat = vi.fn();
  const onRenameConversation = vi.fn();

  render(
    <ConversationTabButton
      conversation={conversation}
      activeConversationId={conversation.id}
      onSwitchChat={onSwitchChat}
      onCloseChat={onCloseChat}
      onRenameConversation={onRenameConversation}
      totalConversationCount={2}
      fallbackBusy={false}
      taskId="task-1"
    />
  );

  return { onSwitchChat, onCloseChat, onRenameConversation };
}

describe('ConversationTabButton', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts inline rename on title double-click while keeping the icon visible', async () => {
    renderConversationTabButton();

    fireEvent.doubleClick(screen.getByTitle('Codex'));

    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByTestId('agent-logo')).toBeInTheDocument();
  });

  it('submits the trimmed title on Enter', async () => {
    const { onRenameConversation } = renderConversationTabButton();

    fireEvent.doubleClick(screen.getByTitle('Codex'));
    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.change(input, { target: { value: '  Codex Review  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(onRenameConversation).toHaveBeenCalledWith('conv-1', 'Codex Review')
    );
  });

  it('cancels on Escape and ignores blank or unchanged titles', async () => {
    const { onRenameConversation } = renderConversationTabButton();

    fireEvent.doubleClick(screen.getByTitle('Codex'));
    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameConversation).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByTitle('Codex'));
    const unchangedInput = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.keyDown(unchangedInput, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Rename chat Codex' })).not.toBeInTheDocument()
    );
    expect(onRenameConversation).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByTitle('Codex'));
    const blankInput = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.change(blankInput, { target: { value: '   ' } });
    fireEvent.keyDown(blankInput, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Rename chat Codex' })).not.toBeInTheDocument()
    );
    expect(onRenameConversation).not.toHaveBeenCalled();
  });
});
