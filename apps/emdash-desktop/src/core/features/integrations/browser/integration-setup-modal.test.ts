import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationSetupModal } from './integration-setup-modal';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), complete: vi.fn() }));
vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    integrationById: {
      plain: {
        name: 'Plain',
        auth: {
          accountLabelRequired: true,
          methods: [
            {
              kind: 'form',
              fields: [
                {
                  id: 'apiKey',
                  label: 'API key',
                  secret: true,
                  required: true,
                  defaultValue: 'test-token',
                },
              ],
            },
          ],
        },
      },
    },
    connectIntegration: mocks.connect,
    isIntegrationMutating: () => false,
  }),
}));
vi.mock('@core/manifests/browser/integration-auth-contributions', () => ({
  getIntegrationAuthUi: () => undefined,
  supportsIntegrationReconnect: () => true,
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useModalController: () => ({ complete: mocks.complete, dismiss: vi.fn() }),
}));
vi.mock('@core/primitives/keybindings/browser/confirm-button', async () => {
  const React = await import('react');
  return {
    ConfirmButton: ({
      children,
      onClick,
      disabled,
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', { onClick, disabled }, children),
  };
});
vi.mock('@emdash/ui/react/primitives', async () => {
  const React = await import('react');
  const Container = ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', {}, children);
  return {
    Dialog: { Header: Container, Title: Container, Body: Container, Footer: Container },
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement('input', { ...props, autoFocus: false }),
    Button: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', { onClick }, children),
    useToast: () => ({ toast: vi.fn() }),
  };
});

describe('integration setup account identity', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    mocks.connect.mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('requires an account name for a new identity-less connection', async () => {
    await act(async () =>
      root.render(React.createElement(IntegrationSetupModal, { integration: 'plain' }))
    );
    const name = container.querySelector<HTMLInputElement>('[aria-label="Account name"]');
    expect(name?.value).toBe('');
    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Connect'
    );
    expect(submit?.disabled).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('reconnects the selected row with its label outside the credential bag', async () => {
    await act(async () =>
      root.render(
        React.createElement(IntegrationSetupModal, {
          integration: 'plain',
          accountId: 'default',
          displayName: 'Support team',
        })
      )
    );
    expect(container.querySelector<HTMLInputElement>('[aria-label="Account name"]')?.value).toBe(
      'Support team'
    );
    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reconnect'
    );
    expect(submit?.disabled).toBe(false);
    await act(async () => {
      submit?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    expect(mocks.connect).toHaveBeenCalledWith(
      'plain',
      { apiKey: 'test-token' },
      { accountId: 'default', displayName: 'Support team' }
    );
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
