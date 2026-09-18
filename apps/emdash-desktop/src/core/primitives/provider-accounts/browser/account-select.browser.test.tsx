import '@emdash/ui/style.css';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ProviderAccountSummary } from '../api/provider-account-summary';
import { ProviderAccountSelect } from './account-select';

const work: ProviderAccountSummary = {
  providerId: 'linear',
  accountId: 'work',
  displayName: 'Engineering workspace',
  displayDetail: 'company@example.com',
  credentialSource: 'form',
  isDefault: true,
};
const personal: ProviderAccountSummary = {
  providerId: 'linear',
  accountId: 'personal',
  displayName: 'Personal workspace',
  isDefault: false,
};

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProviderAccountSelect', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('selects workspace accounts using their display metadata without GitHub identity fields', async () => {
    const onChange = vi.fn();
    function Picker() {
      const [selectedAccount, setSelectedAccount] = useState(work);
      return (
        <ProviderAccountSelect
          providerName="Linear"
          accounts={[work, personal]}
          selectedAccount={selectedAccount}
          onAccountChange={(id) => {
            onChange(id);
            setSelectedAccount(id === work.accountId ? work : personal);
          }}
        />
      );
    }
    await act(async () => root.render(<Picker />));
    const trigger = page.getByRole('combobox', { name: 'Linear account' });
    await expect.element(trigger).toHaveTextContent(work.displayName);
    await act(async () => trigger.click());
    const workOption = page.getByRole('option', { name: /Engineering workspace/ });
    await expect.element(workOption).toHaveTextContent('company@example.com');
    await expect.element(workOption).toHaveTextContent('Saved credentials');
    await act(async () => page.getByRole('option', { name: 'Personal workspace' }).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('personal');
    await expect.element(trigger).toHaveTextContent('Personal workspace');
  });

  it('disables the picker and names the provider when its inventory is empty', async () => {
    await act(async () =>
      root.render(
        <ProviderAccountSelect
          providerName="Jira"
          accounts={[]}
          selectedAccount={null}
          onAccountChange={vi.fn()}
        />
      )
    );
    const trigger = page.getByRole('combobox', { name: 'Jira account' });
    await expect.element(trigger).toBeDisabled();
    await expect.element(trigger).toHaveTextContent('No Jira account');
  });
});
