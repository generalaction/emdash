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
