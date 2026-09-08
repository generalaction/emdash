/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../prompt-editor/prompt-editor', () => ({
  PromptEditor: () => <div data-testid="prompt-editor" />,
}));

import { ChatComposer } from './index';

describe('ChatComposer', () => {
  it('exposes the disabled shell state and disables submission', () => {
    const { container } = render(<ChatComposer disabled onSubmit={() => {}} />);

    const shell = container.querySelector<HTMLElement>('[data-slot="chat-composer-shell"]');
    expect(shell).not.toBeNull();
    expect(shell?.dataset.state).toBe('disabled');
    expect(shell?.getAttribute('aria-disabled')).toBe('true');
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled
    ).toBe(true);
  });

  it('announces error notices and marks the shell invalid', () => {
    const { container } = render(
      <ChatComposer
        notice={{ variant: 'error', title: 'Message not sent', message: 'Try again.' }}
        onSubmit={() => {}}
      />
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Message not sent');
    expect(
      container
        .querySelector<HTMLElement>('[data-slot="chat-composer-shell"]')
        ?.getAttribute('aria-invalid')
    ).toBe('true');
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
});
