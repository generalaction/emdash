/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prompt-editor/prompt-editor', () => ({
  PromptEditor: () => <div data-testid="prompt-editor" />,
}));

import { ChatComposer } from './index';

afterEach(cleanup);

describe('ChatComposer', () => {
  it('shows startup failures on the MCP trigger and affected server, including while disabled', async () => {
    const { getByRole, findByRole, queryByText, getByText } = render(
      <ChatComposer
        disabled
        onSubmit={() => {}}
        mcpServers={[
          { name: 'docs', transport: 'http', startupError: 'Connection refused' },
          { name: 'filesystem', transport: 'stdio' },
        ]}
      />
    );
    const trigger = getByRole('button', { name: '2 session MCP servers, 1 startup failure' });
    expect(trigger.hasAttribute('disabled')).toBe(false);
    expect(trigger.hasAttribute('data-failed')).toBe(true);
    expect(trigger.textContent).toBe('2');
    expect(trigger.querySelectorAll('svg')).toHaveLength(1);
    fireEvent.click(trigger);
    const info = await findByRole('button', { name: 'docs startup error' });
    expect(queryByText('Connection refused')).toBeNull();
    expect(getByText('docs').parentElement?.parentElement?.hasAttribute('data-failed')).toBe(true);
    expect(getByText('docs').nextElementSibling).toBe(info);
    expect(getByText('http').hasAttribute('data-failed')).toBe(true);
    expect(getByText('stdio').hasAttribute('data-failed')).toBe(false);
    fireEvent.keyDown(document, { key: 'Tab' });
    info.focus();
    expect((await findByRole('tooltip')).textContent).toBe('Connection refused');
  });

  it('shows the selected effort beside the model and keeps the MCP trigger compact', () => {
    const { container, getByRole } = render(
      <ChatComposer
        modelOptions={{ 'gpt-5.6-sol': { name: 'GPT-5.6-Sol' } }}
        selectedModel="gpt-5.6-sol"
        onModelChange={() => {}}
        effortOptions={{ high: { name: 'High' } }}
        selectedEffort="high"
        onEffortChange={() => {}}
        mcpServers={[
          { name: 'Filesystem', transport: 'stdio' },
          { name: 'GitHub', transport: 'http' },
        ]}
        onSubmit={() => {}}
      />
    );

    const modelTrigger = container.querySelector('[data-slot="combobox-trigger"]');
    expect(modelTrigger?.textContent).toBe('GPT-5.6-Sol High');
    const mcpTrigger = getByRole('button', { name: '2 session MCP servers' });
    expect(mcpTrigger.textContent).toBe('2');
    expect(mcpTrigger.hasAttribute('data-failed')).toBe(false);
  });

  it('caps the permission-mode popup at its compact width', async () => {
    render(
      <ChatComposer
        permissionModeOptions={{
          readOnly: {
            name: 'Read-only',
            description: 'Requires approval to edit files and run commands.',
          },
          fullAccess: {
            name: 'Agent (full access)',
            description:
              'Can edit files outside this workspace and run commands with network access.',
          },
        }}
        selectedPermissionMode="readOnly"
        onPermissionModeChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const trigger = document.body.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    await waitFor(() => {
      const popup = document.body.querySelector<HTMLElement>('[data-slot="select-content"]');
      expect(popup).not.toBeNull();
      expect(popup!.style.width).toBe('min(18rem, var(--available-width, 18rem))');
      expect(popup!.style.minWidth).toBe('0px');
      expect(popup!.style.maxWidth).toBe('18rem');
    });
  });

  it('exposes collaboration mode separately from permission mode', async () => {
    const onCollaborationModeChange = vi.fn();
    render(
      <ChatComposer
        collaborationModeOptions={{
          default: { name: 'Default' },
          plan: { name: 'Plan', description: 'Plan before making changes' },
        }}
        selectedCollaborationMode="default"
        onCollaborationModeChange={onCollaborationModeChange}
        permissionModeOptions={{ agent: { name: 'Agent' } }}
        selectedPermissionMode="agent"
        onPermissionModeChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const collaborationTrigger = document.body.querySelector<HTMLElement>(
      '[aria-label="Collaboration mode"]'
    );
    const triggers = document.body.querySelectorAll<HTMLElement>('[data-slot="select-trigger"]');
    expect(collaborationTrigger).not.toBeNull();
    expect(Array.from(triggers).map((trigger) => trigger.textContent)).toEqual([
      'Default',
      'Agent',
    ]);

    fireEvent.click(collaborationTrigger!);
    await waitFor(() => {
      expect(document.body.querySelectorAll('[data-slot="select-item"]')).toHaveLength(2);
    });
    const planItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((item) => item.textContent?.includes('Plan'));
    expect(planItem).toBeDefined();
    fireEvent.pointerDown(planItem!, { pointerType: 'mouse', button: 0 });
    fireEvent.click(planItem!, { detail: 1 });

    await waitFor(() => expect(onCollaborationModeChange).toHaveBeenCalledWith('plan'));
  });
});
