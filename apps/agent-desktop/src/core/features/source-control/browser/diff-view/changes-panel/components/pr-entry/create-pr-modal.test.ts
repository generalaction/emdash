import { JSDOM } from 'jsdom';
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePrModal } from './create-pr-modal';

const mocks = vi.hoisted(() => ({
  provider: 'github',
  enabled: true,
  accountAvailable: true,
  resolveAccount: vi.fn(),
  save: vi.fn(async () => ({ success: true })),
  create: vi.fn(async () => ({ success: true })),
  complete: vi.fn(),
}));

vi.mock('@core/features/integrations/api/browser/use-project-account', () => ({
  useProjectAccount: (...args: unknown[]) => {
    mocks.resolveAccount(...args);
    return {
      value: mocks.accountAvailable ? { accountId: 'current' } : null,
      provenance: { kind: 'inferred' },
    };
  },
}));
vi.mock('@core/features/integrations/api/browser/use-provider-accounts', () => ({
  useAccounts: () => ({ data: mocks.accountAvailable ? [{ accountId: 'current' }] : [] }),
}));
vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    integrationById: { github: { name: 'GitHub' }, gitlab: { name: 'GitLab' } },
  }),
}));
vi.mock('@core/features/integrations/contributions/browser/integration-icon', () => ({
  IntegrationIcon: () => null,
}));
vi.mock('@core/features/integrations/contributions/browser/provider-identity-strip', () => ({
  ProviderIdentityStrip: ({
    providerName,
    onSelect,
  }: {
    providerName: string;
    onSelect: (account: { accountId: string }) => void;
  }) =>
    React.createElement(
      'button',
      { onClick: () => onSelect({ accountId: 'selected' }) },
      `Choose ${providerName} account`
    ),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: () => ({ save: mocks.save }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => {
    const remote = { name: 'origin', url: `https://${mocks.provider}.com/acme/app` };
    const branch = { type: 'remote', remote, branch: 'main' };
    return {
      providerRepository: {
        provider: mocks.provider,
        capabilities: { pullRequests: mocks.enabled },
      },
      defaultBranchRef: branch,
      branchRefs: [branch],
      remotes: [remote],
      baseRemote: remote,
      pushRemote: remote,
      effectiveGitSettings: { baseRemote: { value: 'origin', provenance: { kind: 'inferred' } } },
    };
  },
}));
vi.mock('@core/features/workspaces/api/browser/stores/workspace-registry', () => ({
  workspaceRegistry: { get: () => ({ get: () => ({ isPublished: true, aheadCount: 0 }) }) },
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useModalController: () => ({ complete: mocks.complete }),
  useOpenModal: () => vi.fn(),
}));
vi.mock('@core/primitives/modals/react', () => ({ defineModal: () => (value: unknown) => value }));
vi.mock('@core/services/pull-requests/api/client', () => ({
  getPullRequestsRuntimeClient: async () => ({ createPullRequest: mocks.create }),
}));
vi.mock('@core/features/source-control/contributions/browser/project-branch-selector', () => ({
  ProjectBranchSelector: () => null,
}));
vi.mock('@core/features/source-control/contributions/browser/branch-display', () => ({
  BranchDisplay: () => null,
}));
vi.mock('@core/features/source-control/contributions/browser/remote-selector', () => ({
  RemoteSelector: () => null,
}));
vi.mock('@core/features/projects/contributions/browser/settings-provenance', () => ({
  BrokenSettingNotice: () => null,
}));
vi.mock('@core/primitives/keybindings/browser/confirm-button', () => ({
  ConfirmButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => React.createElement('button', { onClick, disabled }, children),
}));
vi.mock('@agent/ui/react/primitives', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const container = ({ children }: { children: ReactNode }) =>
    React.createElement('div', null, children);
  return {
    ...actual,
    Dialog: { Header: container, Body: container, Footer: container, Title: container },
  };
});

describe('CreatePrModal provider routing', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider = 'github';
    mocks.enabled = true;
    mocks.accountAvailable = true;
    mocks.save.mockResolvedValue({ success: true });
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });
  async function render(provider: string) {
    mocks.provider = provider;
    await act(async () =>
      root.render(
        React.createElement(CreatePrModal, {
          projectId: 'project',
          taskId: 'task',
          workspaceId: 'workspace',
          repositoryUrl: `https://${provider}.com/acme/app`,
          branchName: 'feature',
          draft: false,
        })
      )
    );
  }
  function button(text: string) {
    const result = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === text
    );
    if (!result) throw new Error(`Button not found: ${text}`);
    return result;
  }
  it.each([
    ['github', 'GitHub', 'PR', 'Pull Request'],
    ['gitlab', 'GitLab', 'MR', 'Merge Request'],
  ])(
    'routes %s creation and account persistence through the selected provider',
    async (provider, name, short, title) => {
      await render(provider);
      expect(container.textContent).toContain(`Create ${title}`);
      expect(container.querySelector('input')?.placeholder).toBe(`${short} title`);
      expect(mocks.resolveAccount).toHaveBeenCalledWith('project', provider, {
        repository: { kind: 'url', url: `https://${provider}.com/acme/app` },
      });
      await act(async () => button(`Choose ${name} account`).click());
      expect(mocks.save).toHaveBeenCalledWith({
        integrationAccounts: {
          stored: {
            [provider]: { kind: 'account', accountId: 'selected' },
          },
        },
      });
      await act(async () => button(`Create ${short}`).click());
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: `https://${provider}.com/acme/app`,
          head: 'feature',
          base: 'main',
          draft: false,
        })
      );
      expect(mocks.complete).toHaveBeenCalled();
    }
  );
  it('blocks GitLab creation when the repository capability is disabled', async () => {
    mocks.enabled = false;
    await render('gitlab');
    expect(button('Create MR').disabled).toBe(true);
    await act(async () => button('Create MR').click());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('blocks GitLab creation without an account', async () => {
    mocks.accountAvailable = false;
    await render('gitlab');
    expect(button('Create MR').disabled).toBe(true);
    await act(async () => button('Create MR').click());
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('blocks GitLab creation after the account preference fails to save', async () => {
    mocks.save.mockResolvedValueOnce({ success: false });
    await render('gitlab');
    await act(async () => button('Choose GitLab account').click());
    expect(container.textContent).toContain('before creating the MR');
    expect(button('Create MR').disabled).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
