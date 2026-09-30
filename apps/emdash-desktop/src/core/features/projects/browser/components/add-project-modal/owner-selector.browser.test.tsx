import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api/provider-account-summary';
import { OwnerSelector } from './owner-selector';

it('changes accounts inside the owner menu without selecting or closing the owner', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onAccountChange = vi.fn();
  const onOwnerChange = vi.fn();
  const accounts: ProviderAccountSummary[] = [
    { providerId: 'github', accountId: 'personal', displayName: 'Personal', isDefault: true },
    { providerId: 'github', accountId: 'work', displayName: 'Work', isDefault: false },
  ];
  try {
    await act(async () =>
      root.render(
        <OwnerSelector
          owners={[{ value: 'org', label: 'My organization', avatarUrl: '' }]}
          owner={null}
          accounts={accounts}
          selectedAccount={accounts[0]!}
          onAccountChange={onAccountChange}
          onOwnerChange={onOwnerChange}
        />
      )
    );
    const ownerTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Repository owner"]')!;
    await act(async () => ownerTrigger.click());
    await act(async () => page.getByRole('combobox', { name: 'GitHub account' }).click());
    await act(async () => userEvent.keyboard('{End}{Enter}'));

    expect(onAccountChange).toHaveBeenCalledExactlyOnceWith('work');
    expect(onOwnerChange).not.toHaveBeenCalled();
    await expect.element(page.getByPlaceholder('Search owners...')).toBeVisible();
    await act(async () => page.getByRole('option', { name: 'My organization' }).click());
    expect(onOwnerChange).toHaveBeenCalledExactlyOnceWith({
      value: 'org',
      label: 'My organization',
      avatarUrl: '',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
