import '@emdash/ui/style.css';
import { Dialog } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { IntegrationSetupModal } from '@core/features/integrations/browser/integration-setup-modal';
import { ModalHostTestProvider, type ModalHostController } from '@core/primitives/modals/react';
import { modalStore } from '@core/primitives/modals/react/modal-store';

const accountHooks = vi.hoisted(() => ({
  session: { isSignedIn: false, hasAccount: false },
  signIn: vi.fn(async (_provider: string | undefined) => ({
    success: true,
    providerAccount: { login: 'dkonopka' },
    providerAccountStatus: 'created',
  })),
  linkProvider: vi.fn(async (_provider: string | undefined) => ({ success: true })),
}));

const githubHooks = vi.hoisted(() => ({
  deviceFlowAuth: vi.fn(async () => ({ success: true })),
  importCliAccounts: vi.fn(async () => ({ success: true, importedAccountIds: [] as string[] })),
}));

vi.mock('@core/features/account/api/browser/useAccount', () => ({
  useAccountSession: () => ({ data: accountHooks.session }),
  useAccountSignIn: () => ({ mutateAsync: accountHooks.signIn, isPending: false }),
  useAccountLinkProvider: () => ({ mutateAsync: accountHooks.linkProvider, isPending: false }),
}));

vi.mock('@core/features/github/api/browser/use-github-auth', () => ({
  useGitHubDeviceFlowAuth: () => ({ mutateAsync: githubHooks.deviceFlowAuth, isPending: false }),
  useImportGitHubCliAccounts: () => ({
    mutateAsync: githubHooks.importCliAccounts,
    isPending: false,
  }),
}));

vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    integrationById: {
      github: {
        id: 'github',
        name: 'GitHub',
        auth: {
          methods: [
            { kind: 'oauth', providerId: 'github' },
            { kind: 'oauth-device', clientId: 'test', scopes: ['repo'] },
            { kind: 'cli-import', cli: 'gh' },
          ],
        },
      },
    },
  }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

/**
 * Connect-and-resume (spec: github-git-settings §5): a modal that launches the
 * connect flow from its identity strip stays open underneath the modal stack,
 * and the connect modal completes itself on success so the interrupted action
 * becomes topmost again with its state intact.
 */
describe('GitHub connect-and-resume', () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ModalHostController & {
    complete: Mock<(result: unknown) => void>;
    dismiss: Mock<() => void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    accountHooks.session = { isSignedIn: false, hasAccount: false };
    githubHooks.importCliAccounts.mockResolvedValue({ success: true, importedAccountIds: [] });
    controller = {
      complete: vi.fn<(result: unknown) => void>(),
      dismiss: vi.fn<() => void>(),
      setCloseGuard: vi.fn<(active: boolean) => void>(),
      hasActiveCloseGuard: false,
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    modalStore.dismissAll();
    for (const entry of [...modalStore.stack]) modalStore.removeEntry(entry.key);
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderConnectModal() {
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <Dialog.Content size="md">
            <ModalHostTestProvider id="integrationSetupModal" controller={controller}>
              <IntegrationSetupModal integration="github" />
            </ModalHostTestProvider>
          </Dialog.Content>
        </Dialog.Root>
      );
    });
  }

  function methodButton(label: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`no connect method button labelled "${label}"`);
    return button;
  }

  it('keeps the interrupted modal on the stack and returns it to the top after connect', async () => {
    let interruptedSettled = false;
    const interrupted = modalStore.open('createPrModal', {});
    void interrupted.then(() => {
      interruptedSettled = true;
    });

    void modalStore.open('integrationSetupModal', { integration: 'github' });
    expect(modalStore.activeModalId).toBe('integrationSetupModal');

    modalStore.complete(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(modalStore.activeModalId).toBe('createPrModal');
    expect(interruptedSettled).toBe(false);
  });

  it('completes the connect modal after a successful OAuth connect', async () => {
    await renderConnectModal();

    await act(async () => methodButton('Continue').click());

    expect(accountHooks.signIn).toHaveBeenCalledWith('github');
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('disables every method and Cancel while authentication is pending', async () => {
    let finishSignIn!: () => void;
    accountHooks.signIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSignIn = () =>
            resolve({
              success: true,
              providerAccount: { login: 'dkonopka' },
              providerAccountStatus: 'created',
            });
        })
    );
    await renderConnectModal();
    await act(async () => methodButton('Continue').click());

    const pending = methodButton('Continuing...');
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(methodButton('Import from GitHub CLI').disabled).toBe(true);
    expect(methodButton('Use device flow').disabled).toBe(true);
    const cancel = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel'
    );
    expect(cancel?.disabled).toBe(true);

    await act(async () => {
      methodButton('Import from GitHub CLI').click();
      cancel?.click();
    });
    expect(githubHooks.importCliAccounts).not.toHaveBeenCalled();
    expect(controller.dismiss).not.toHaveBeenCalled();
    await act(async () => finishSignIn());
    expect(methodButton('Continue').disabled).toBe(false);
    expect(cancel?.disabled).toBe(false);
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('shows method errors and lets the user try another method', async () => {
    await renderConnectModal();
    await act(async () => methodButton('Import from GitHub CLI').click());

    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toContain('No GitHub CLI session found. Run gh auth login first.');
    expect(methodButton('Import from GitHub CLI').getAttribute('aria-describedby')).toBe(error?.id);
    expect(methodButton('Import from GitHub CLI').disabled).toBe(false);
    expect(controller.complete).not.toHaveBeenCalled();

    await act(async () => methodButton('Continue').click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(accountHooks.signIn).toHaveBeenCalledWith('github');
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('offers account linking for signed-in users and hides device flow', async () => {
    accountHooks.session = { isSignedIn: true, hasAccount: true };
    await renderConnectModal();
    expect(document.querySelector('button[aria-label="Use device flow"]')).toBeNull();
    await act(async () => methodButton('Link').click());
    expect(accountHooks.linkProvider).toHaveBeenCalledWith('github');
    expect(accountHooks.signIn).not.toHaveBeenCalled();
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('completes the shared connect modal after importing CLI accounts', async () => {
    githubHooks.importCliAccounts.mockResolvedValue({
      success: true,
      importedAccountIds: ['github.com:42'],
    });
    await renderConnectModal();
    await act(async () => methodButton('Import from GitHub CLI').click());
    expect(githubHooks.importCliAccounts).toHaveBeenCalled();
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('completes the connect modal when the device flow modal completes', async () => {
    await renderConnectModal();

    await act(async () => methodButton('Use device flow').click());

    expect(modalStore.activeModalId).toBe('githubDeviceFlowModal');
    expect(controller.complete).not.toHaveBeenCalled();

    await act(async () => {
      modalStore.complete(undefined);
    });

    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('keeps the connect modal open when the device flow is dismissed', async () => {
    await renderConnectModal();

    await act(async () => methodButton('Use device flow').click());
    await act(async () => {
      modalStore.dismiss();
    });

    expect(controller.complete).not.toHaveBeenCalled();
    expect(controller.dismiss).not.toHaveBeenCalled();
  });
});
