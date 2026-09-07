import '@emdash/ui/style.css';
import { Dialog } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GithubConnectModal } from '@core/features/settings/browser/components/github-connect-modal';
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
  importCliAccounts: vi.fn(async () => ({ success: true, importedAccountIds: [] })),
}));

vi.mock('@core/features/account/api/browser/useAccount', () => ({
  useAccountSession: () => ({ data: accountHooks.session }),
  useAccountSignIn: () => ({ mutateAsync: accountHooks.signIn, isPending: false }),
  useAccountLinkProvider: () => ({ mutateAsync: accountHooks.linkProvider, isPending: false }),
}));

vi.mock('@core/features/github/api/browser/useGithubAccounts', () => ({
  useGitHubDeviceFlowAuth: () => ({ mutateAsync: githubHooks.deviceFlowAuth, isPending: false }),
  useImportGitHubCliAccounts: () => ({
    mutateAsync: githubHooks.importCliAccounts,
    isPending: false,
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
    accountHooks.signIn.mockClear();
    githubHooks.deviceFlowAuth.mockClear();
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
            <ModalHostTestProvider id="githubConnectModal" controller={controller}>
              <GithubConnectModal />
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

    void modalStore.open('githubConnectModal', {});
    expect(modalStore.activeModalId).toBe('githubConnectModal');

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
