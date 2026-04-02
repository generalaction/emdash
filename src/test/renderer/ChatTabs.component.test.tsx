import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatTabs } from '../../renderer/components/ChatTabs';

vi.mock('../../renderer/components/AgentLogo', () => ({
  default: () => <div data-testid="agent-logo" />,
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

const tabs = [
  {
    id: 'tab-1',
    title: 'Codex',
    provider: 'codex',
    isActive: true,
  },
  {
    id: 'tab-2',
    title: 'Second Tab',
    provider: 'codex',
    isActive: false,
  },
];

function renderChatTabs(overrides?: Partial<React.ComponentProps<typeof ChatTabs>>) {
  const onTabClick = vi.fn();
  const onCloseTab = vi.fn();
  const onRenameTab = vi.fn();

  render(
    <ChatTabs
      tabs={tabs}
      activeTabId="tab-1"
      onTabClick={onTabClick}
      onCloseTab={onCloseTab}
      onRenameTab={onRenameTab}
      {...overrides}
    />
  );

  return { onTabClick, onCloseTab, onRenameTab };
}

describe('ChatTabs', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts inline rename on tab title double-click while keeping the icon visible', async () => {
    renderChatTabs();

    fireEvent.doubleClick(screen.getByTitle('Codex'));

    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getAllByTestId('agent-logo')).toHaveLength(2);
  });

  it('starts inline rename from the pencil button and saves on Enter', async () => {
    const { onRenameTab } = renderChatTabs();

    fireEvent.click(screen.getAllByTitle('Rename chat')[0]);

    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.change(input, { target: { value: 'Codex Review' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'Codex Review'));
  });

  it('cancels inline rename on Escape', async () => {
    const { onRenameTab } = renderChatTabs();

    fireEvent.doubleClick(screen.getByTitle('Codex'));

    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.change(input, { target: { value: 'Discarded Title' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameTab).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Rename chat Codex' })).not.toBeInTheDocument();
  });

  it('does not submit blank or unchanged titles', async () => {
    const { onRenameTab } = renderChatTabs();

    fireEvent.doubleClick(screen.getByTitle('Codex'));
    const input = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Rename chat Codex' })).not.toBeInTheDocument()
    );
    expect(onRenameTab).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByTitle('Codex'));
    const secondInput = await screen.findByRole('textbox', { name: 'Rename chat Codex' });
    fireEvent.change(secondInput, { target: { value: '   ' } });
    fireEvent.keyDown(secondInput, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Rename chat Codex' })).not.toBeInTheDocument()
    );
    expect(onRenameTab).not.toHaveBeenCalled();
  });
});
