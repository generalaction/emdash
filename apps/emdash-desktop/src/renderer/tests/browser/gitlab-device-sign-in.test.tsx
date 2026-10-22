import '@emdash/ui/style.css';
import { Dialog } from '@emdash/ui/react/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { IntegrationSetupModal } from '@core/features/integrations/browser/integration-setup-modal';
import { ModalHostTestProvider, type ModalHostController } from '@core/primitives/modals/react';
import { modalStore } from '@core/primitives/modals/react/modal-store';

const client = vi.hoisted(() => ({
  startDeviceFlow: vi.fn(),
  completeDeviceFlow: vi.fn(),
  cancelDeviceFlow: vi.fn(async () => undefined),
}));
const host = vi.hoisted(() => ({ openExternal: vi.fn(async () => undefined) }));
const accountHooks = vi.hoisted(() => ({
  session: { isSignedIn: false, hasAccount: false },
  signIn: vi.fn(async (_input: { provider?: string; accountId?: string } | undefined) => ({
    success: true,
  })),
  linkProvider: vi.fn(async (_input: { provider?: string; accountId?: string } | undefined) => ({
    success: true,
    providerAccount: { login: 'tanuki' },
    providerAccountStatus: 'created',
  })),
}));

vi.mock('@core/features/account/api/browser/useAccount', () => ({
  useAccountSession: () => ({ data: accountHooks.session }),
  useAccountSignIn: () => ({ mutateAsync: accountHooks.signIn, isPending: false }),
  useAccountLinkProvider: () => ({ mutateAsync: accountHooks.linkProvider, isPending: false }),
}));

vi.mock('@core/features/integrations/api/browser/client', () => ({
  getIntegrationsClient: async () => client,
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  openExternal: host.openExternal,
}));

vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    integrationById: {
      gitlab: {
        id: 'gitlab',
        name: 'GitLab',
        auth: {
          methods: [
            { kind: 'oauth', providerId: 'gitlab' },
            { kind: 'oauth-device', clientId: 'test', scopes: ['api', 'read_user'] },
            {
              kind: 'form',
              fields: [
                { id: 'instanceUrl', label: 'Instance URL', required: true, secret: false },
                { id: 'apiToken', label: 'Personal access token', required: true, secret: true },
              ],
            },
          ],
        },
      },
    },
    connectIntegration: vi.fn(),
    isIntegrationMutating: () => false,
  }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const started = {
  success: true as const,
  flowId: 'flow-1',
  userCode: 'N03SDJ4B',
  verificationUri: 'https://gitlab.com/oauth/device',
  verificationUriComplete: 'https://gitlab.com/oauth/device?user_code=N03SDJ4B',
  expiresIn: 300,
};

describe('GitLab device sign-in', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ModalHostController & {
    complete: Mock<(result: unknown) => void>;
    dismiss: Mock<() => void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    accountHooks.session = { isSignedIn: false, hasAccount: false };
    controller = {
      complete: vi.fn<(result: unknown) => void>(),
      dismiss: vi.fn<() => void>(),
      setCloseGuard: vi.fn<(active: boolean) => void>(),
      hasActiveCloseGuard: false,
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    modalStore.dismissAll();
    for (const entry of [...modalStore.stack]) modalStore.removeEntry(entry.key);
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(id: string, children: React.ReactNode) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Dialog.Root open>
            <Dialog.Content size="md">
              <ModalHostTestProvider id={id} controller={controller}>
                {children}
              </ModalHostTestProvider>
            </Dialog.Content>
          </Dialog.Root>
        </QueryClientProvider>
      );
    });
  }

  function button(label: string): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button labelled "${label}"`);
    return found;
  }

  function buttonWithText(text: string): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === text
    );
    if (!found) throw new Error(`no button with text "${text}"`);
    return found;
  }

  /** Opens the connect modal and chooses device sign-in, which stays inside that modal. */
  async function startDeviceSignIn(accountId?: string) {
    await render(
      'integrationSetupModal',
      <IntegrationSetupModal integration="gitlab" {...(accountId ? { accountId } : {})} />
    );
    await act(async () => button('Use device flow').click());
  }

  it('offers Emdash sign-in, device sign-in, and the token form', async () => {
    await render('integrationSetupModal', <IntegrationSetupModal integration="gitlab" />);
    expect(button('Continue')).toBeTruthy();
    expect(button('Use device flow')).toBeTruthy();

    await act(async () => button('Use an access token').click());
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('signs in to Emdash with GitLab', async () => {
    await render('integrationSetupModal', <IntegrationSetupModal integration="gitlab" />);
    await act(async () => button('Continue').click());
    expect(accountHooks.signIn).toHaveBeenCalledWith({ provider: 'gitlab' });
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('links GitLab to a signed-in Emdash account instead of offering device sign-in', async () => {
    accountHooks.session = { isSignedIn: true, hasAccount: true };
    await render('integrationSetupModal', <IntegrationSetupModal integration="gitlab" />);
    expect(document.querySelector('button[aria-label="Use device flow"]')).toBeNull();

    await act(async () => button('Link').click());
    expect(accountHooks.linkProvider).toHaveBeenCalledWith({ provider: 'gitlab' });
    expect(controller.complete).toHaveBeenCalledTimes(1);
  });

  it('signs in with a code inside the connect modal and completes it on approval', async () => {
    client.startDeviceFlow.mockResolvedValue(started);
    let approve!: () => void;
    client.completeDeviceFlow.mockReturnValue(
      new Promise((resolve) => {
        approve = () =>
          resolve({
            success: true,
            accountId: 'gitlab.com:42',
            displayName: 'Tucker',
            login: 'tdewitt',
          });
      })
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      await startDeviceSignIn();

      expect(modalStore.stack).toHaveLength(0);
      expect(document.body.textContent).toContain('Connect GitLab');
      expect(client.startDeviceFlow).toHaveBeenCalledWith({ integrationId: 'gitlab' });
      expect(document.body.textContent).toContain('N03SDJ4B');
      expect(document.body.textContent).toContain('Opening GitLab in 3s');
      expect(host.openExternal).not.toHaveBeenCalled();
      expect(client.completeDeviceFlow).toHaveBeenCalledWith(
        { flowId: 'flow-1' },
        { timeoutMs: (300 + 60) * 1000 }
      );

      for (let second = 0; second < 3; second += 1) {
        await act(async () => vi.advanceTimersByTime(1000));
      }
      expect(host.openExternal).toHaveBeenCalledTimes(1);
      expect(host.openExternal).toHaveBeenCalledWith(started.verificationUriComplete);

      await act(async () => approve());
      expect(controller.complete).toHaveBeenCalledTimes(1);
      expect(client.cancelDeviceFlow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('copies the code when the verification page does not prefill it', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const { verificationUriComplete: _prefilled, ...withoutPrefill } = started;
    client.startDeviceFlow.mockResolvedValue(withoutPrefill);
    client.completeDeviceFlow.mockReturnValue(new Promise(() => {}));
    try {
      await startDeviceSignIn();
      expect(writeText).toHaveBeenCalledWith('N03SDJ4B');
      expect(button('Code copied')).toBeTruthy();
    } finally {
      writeText.mockRestore();
    }
  });

  it('opens the verification page immediately on Enter', async () => {
    client.startDeviceFlow.mockResolvedValue(started);
    client.completeDeviceFlow.mockReturnValue(new Promise(() => {}));
    await startDeviceSignIn();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(host.openExternal).toHaveBeenCalledWith(started.verificationUriComplete);
  });

  it('reconnects the selected account', async () => {
    client.startDeviceFlow.mockResolvedValue(started);
    client.completeDeviceFlow.mockReturnValue(new Promise(() => {}));
    await startDeviceSignIn('https://gitlab.com:42');
    expect(client.startDeviceFlow).toHaveBeenCalledWith({
      integrationId: 'gitlab',
      accountId: 'https://gitlab.com:42',
    });
  });

  it('reconnects the selected account through Emdash sign-in', async () => {
    await render(
      'integrationSetupModal',
      <IntegrationSetupModal integration="gitlab" accountId="https://gitlab.com:42" />
    );
    await act(async () => button('Continue').click());
    expect(accountHooks.signIn).toHaveBeenCalledWith({
      provider: 'gitlab',
      accountId: 'https://gitlab.com:42',
    });
  });

  it('shows a failure to start inline and tries again', async () => {
    client.startDeviceFlow.mockResolvedValueOnce({
      success: false,
      error: 'Could not reach GitLab.',
    });
    client.startDeviceFlow.mockResolvedValueOnce(started);
    client.completeDeviceFlow.mockReturnValue(new Promise(() => {}));
    await startDeviceSignIn();

    expect(document.body.textContent).toContain('GitLab sign-in failed');
    expect(document.body.textContent).toContain('Could not reach GitLab.');
    expect(client.completeDeviceFlow).not.toHaveBeenCalled();
    expect(host.openExternal).not.toHaveBeenCalled();

    await act(async () => buttonWithText('Try again').click());
    expect(client.startDeviceFlow).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('N03SDJ4B');
  });

  it('shows a denied sign-in inline without completing the connect modal', async () => {
    client.startDeviceFlow.mockResolvedValue(started);
    client.completeDeviceFlow.mockResolvedValue({
      success: false,
      error: 'GitLab sign-in was denied.',
    });
    await startDeviceSignIn();
    expect(document.body.textContent).toContain('GitLab sign-in was denied.');
    expect(modalStore.stack).toHaveLength(0);
    expect(controller.complete).not.toHaveBeenCalled();
  });

  it('cancels the pending flow when going back to the sign-in options', async () => {
    client.startDeviceFlow.mockResolvedValue(started);
    client.completeDeviceFlow.mockReturnValue(new Promise(() => {}));
    await startDeviceSignIn();

    await act(async () => buttonWithText('Back').click());
    await vi.waitFor(() =>
      expect(client.cancelDeviceFlow).toHaveBeenCalledWith({ flowId: 'flow-1' })
    );
    expect(button('Use device flow')).toBeTruthy();
    expect(controller.dismiss).not.toHaveBeenCalled();
  });

  it('cancels the pending flow when the connect modal closes', async () => {
    client.startDeviceFlow.mockResolvedValue(started);
    client.completeDeviceFlow.mockReturnValue(new Promise(() => {}));
    await startDeviceSignIn();

    await act(async () => root.render(<></>));
    await vi.waitFor(() =>
      expect(client.cancelDeviceFlow).toHaveBeenCalledWith({ flowId: 'flow-1' })
    );
  });
});
