import '@emdash/ui/style.css';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ConversationTransportToggle } from '@core/features/conversations/contributions/browser/conversation-transport-toggle';
import type { ConversationType } from '@core/primitives/conversations/api';

it('switches interfaces directly without a highlight and names the next interface in its tooltip', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  container.className = 'emlight';
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  function Control({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState<ConversationType>('acp');
    return (
      <ConversationTransportToggle
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          change(next);
          setValue(next);
        }}
      />
    );
  }
  try {
    await act(async () => root.render(<Control />));
    const toggle = page.getByRole('button', { name: 'Use chat UI' });
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle.element().textContent).toBe('');
    expect(toggle.element().querySelectorAll('svg')).toHaveLength(1);
    expect(toggle.element().querySelector('.lucide-message-square')).not.toBeNull();
    await act(async () => toggle.hover());
    await expect.element(page.getByText('TUI', { exact: true })).toBeVisible();
    expect(getComputedStyle(toggle.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await act(async () => toggle.click());
    expect(change).toHaveBeenLastCalledWith('pty');
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.element().querySelector('.lucide-square-terminal')).not.toBeNull();
    expect(getComputedStyle(toggle.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await act(async () => userEvent.keyboard('{Enter}'));
    expect(change).toHaveBeenLastCalledWith('acp');
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
    await act(async () => root.render(<Control disabled />));
    await expect.element(toggle).toBeDisabled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
