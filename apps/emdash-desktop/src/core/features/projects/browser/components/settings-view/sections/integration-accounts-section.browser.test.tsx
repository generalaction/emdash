import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StoredIntegrationAccounts } from '@core/primitives/project-settings/api';
import type { ProviderAccountsByProvider } from '@core/primitives/provider-accounts/api';
import { IntegrationAccountsSection } from './integration-accounts-section';

const state = vi.hoisted(() => ({
  accounts: undefined as ProviderAccountsByProvider | undefined,
  openModal: vi.fn(),
}));
vi.mock('@core/features/integrations/api/browser/use-provider-accounts', () => ({
  useAccounts: () => ({ data: state.accounts, isError: false }),
}));
vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    integrations: [
      { id: 'github', name: 'GitHub', issueCapabilities: { requiresRepositoryUrl: true } },
      { id: 'jira', name: 'Jira', issueCapabilities: { requiresRepositoryUrl: false } },
      { id: 'gitlab', name: 'GitLab', issueCapabilities: { requiresRepositoryUrl: true } },
      { id: 'forgejo', name: 'Forgejo', issueCapabilities: { requiresRepositoryUrl: true } },
    ],
  }),
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: (id: string) => (args: unknown) => state.openModal(id, args),
}));
vi.mock('@core/features/integrations/contributions/browser/integration-icon', () => ({
  IntegrationIcon: () => null,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('project integration account rows', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    state.accounts = undefined;
    state.openModal.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('lets a sole connected account be pinned or disabled', async () => {
    const update = vi.fn();
    state.accounts = {
      jira: [
        {
          providerId: 'jira',
          accountId: 'jira:a',
          displayName: 'Alice',
          displayDetail: 'acme.atlassian.net',
          isDefault: true,
          credentialSource: 'secure_storage',
        },
      ],
    };
    await act(async () =>
      root.render(
        <IntegrationAccountsSection
          integrationAccountsForm={{}}
          updateIntegrationAccounts={update}
          repositoryHost={null}
        />
      )
    );
    expect(host.textContent).toContain('Jira');
    expect(host.textContent).toContain('Alice');
    expect(host.querySelector('[data-slot="badge"]')?.textContent).toBe('Inferred');
    expect(host.textContent).not.toContain('Reset to inferred');
    expect(host.querySelector('[role="combobox"]')?.getAttribute('aria-disabled')).not.toBe('true');
    expect(host.querySelector('[role="combobox"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
    const pin = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes('Alice')
    );
    expect(pin).toBeDefined();
    await act(async () => pin!.click());
    expect(update).toHaveBeenLastCalledWith('jira', { kind: 'account', accountId: 'jira:a' });

    await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
    const disable = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes('No Jira account')
    );
    expect(disable).toBeDefined();
    await act(async () => disable!.click());
    expect(update).toHaveBeenLastCalledWith('jira', { kind: 'none' });
  });

  it('does not call a pin unavailable before inventory arrives', async () => {
    const render = () =>
      root.render(
        <IntegrationAccountsSection
          integrationAccountsForm={{ jira: { kind: 'account', accountId: 'jira:a' } }}
          updateIntegrationAccounts={vi.fn()}
          repositoryHost={null}
        />
      );
    await act(async () => render());
    expect(host.textContent).toContain('Loading accounts');
    expect(host.textContent).not.toContain('Unavailable');
    expect(host.textContent).not.toContain('no longer connected');

    state.accounts = {};
    await act(async () => render());
    expect(host.textContent).toContain('Unavailable Jira account');
    expect(host.textContent).toContain('no longer connected');
  });

  it.each(['github', 'gitlab', 'forgejo'])(
    'applies repository-host matching and the shared connect entry for %s',
    async (providerId) => {
      state.accounts = {
        [providerId]: [
          {
            providerId,
            accountId: 'other',
            host: 'other.example',
            displayName: 'Other host',
            isDefault: true,
          },
          {
            providerId,
            accountId: 'matched',
            host: 'code.example',
            displayName: 'Host match',
            isDefault: false,
          },
        ],
      };
      const render = (form: StoredIntegrationAccounts) =>
        root.render(
          <IntegrationAccountsSection
            integrationAccountsForm={form}
            updateIntegrationAccounts={vi.fn()}
            repositoryHost="code.example"
          />
        );
      await act(async () => render({}));
      expect(host.querySelector('[role="combobox"]')?.textContent).toContain('Host match');
      await act(async () => render({ [providerId]: { kind: 'account', accountId: 'other' } }));
      expect(host.textContent).toContain("does not match this repository's host");
      await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
      const connect = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.includes('Connect another account')
      );
      expect(connect).toBeDefined();
      await act(async () => connect!.click());
      expect(state.openModal).toHaveBeenCalledWith('integrationSetupModal', {
        integration: providerId,
      });
    }
  );

  it('can disable a missing GitHub account and stays disabled when another account connects', async () => {
    state.accounts = {};
    const update = vi.fn();
    let form: StoredIntegrationAccounts = {
      github: { kind: 'account', accountId: 'github.com:removed' },
    };
    const render = () =>
      root.render(
        <IntegrationAccountsSection
          integrationAccountsForm={form}
          updateIntegrationAccounts={update}
          repositoryHost="github.com"
        />
      );
    await act(async () => render());
    expect(host.textContent).toContain('Unavailable GitHub account');
    await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    const disable = options.find((option) => option.textContent?.includes('No GitHub account'));
    expect(disable).toBeDefined();
    expect(options.some((option) => option.textContent?.includes('Reset to inferred'))).toBe(false);
    expect(host.textContent).toContain('Reset to inferred');
    await act(async () => disable!.click());
    expect(update).toHaveBeenLastCalledWith('github', { kind: 'none' });

    form = { github: { kind: 'none' } };
    state.accounts = {
      github: [
        {
          providerId: 'github',
          accountId: 'github.com:42',
          displayName: '@alice',
          host: 'github.com',
          login: 'alice',
          avatarUrl: '',
          credentialSource: 'device_flow',
          isDefault: true,
        },
      ],
    };
    await act(async () => render());
    expect(host.querySelector('[role="combobox"]')?.textContent).toContain('No GitHub account');
    expect(host.querySelector('[data-slot="badge"]')?.textContent).toBe('Set');
    const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Reset to inferred')
    );
    expect(reset).toBeDefined();
    await act(async () => reset!.click());
    expect(update).toHaveBeenLastCalledWith('github', null);
    form = {};
    await act(async () => render());
    expect(host.querySelector('[data-slot="badge"]')?.textContent).toBe('Inferred');
    expect(host.querySelector('[role="combobox"]')?.textContent).toContain('@alice');
    expect(host.textContent).not.toContain('Reset to inferred');
  });
});
