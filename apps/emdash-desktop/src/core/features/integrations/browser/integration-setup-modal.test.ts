import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationSetupModal } from './integration-setup-modal';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  complete: vi.fn(),
  dismiss: vi.fn(),
  singleJiraMethod: false,
}));
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
      jira: {
        name: 'Jira',
        auth: {
          methods: [
            {
              kind: 'form',
              id: 'basic',
              label: 'Email + API token',
              fields: [
                { id: 'siteUrl', label: 'Site URL', required: true },
                { id: 'email', label: 'Email', required: true },
                { id: 'apiToken', label: 'API token', secret: true, required: true },
              ],
            },
            {
              kind: 'form',
              id: 'bearer',
              label: 'Bearer token',
              fields: [
                {
                  id: 'siteUrl',
                  label: 'Site URL',
                  required: true,
                  defaultValue: 'https://example.atlassian.net',
                },
                {
                  id: 'accessToken',
                  label: 'Bearer token',
                  secret: true,
                  required: true,
                  defaultValue: 'scoped-token',
                },
              ],
            },
          ].filter((_, index) => !mocks.singleJiraMethod || index === 1),
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
  useModalController: () => ({ complete: mocks.complete, dismiss: mocks.dismiss }),
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
    SelectableCard: ({
      children,
      onClick,
      'aria-label': label,
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', { onClick, 'aria-label': label }, children),
    useToast: () => ({ toast: vi.fn() }),
  };
});

describe('integration setup', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    mocks.singleJiraMethod = false;
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

  async function clickButton(label: string) {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === label || candidate.textContent === label
    );
    expect(button).toBeDefined();
    await act(async () => {
      button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  }

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

  it('preserves a shared site URL when switching Jira authentication methods', async () => {
    await act(async () =>
      root.render(React.createElement(IntegrationSetupModal, { integration: 'jira' }))
    );
    await clickButton('Bearer token');
    await clickButton('Back');
    expect(container.querySelector('input')).toBeNull();
    await clickButton('Email + API token');

    expect(container.querySelector<HTMLInputElement>('#integration-field-siteUrl')?.value).toBe(
      'https://example.atlassian.net'
    );
    expect(container.querySelector('#integration-field-accessToken')).toBeNull();
    expect(container.querySelector('#integration-field-email')).not.toBeNull();
    expect(container.querySelector('#integration-field-apiToken')).not.toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('submits the selected Jira bearer form without Basic Auth fields', async () => {
    await act(async () =>
      root.render(React.createElement(IntegrationSetupModal, { integration: 'jira' }))
    );

    await clickButton('Bearer token');

    expect(container.querySelector('#integration-field-email')).toBeNull();
    expect(container.querySelector('#integration-field-apiToken')).toBeNull();
    const siteUrl = container.querySelector<HTMLInputElement>('#integration-field-siteUrl');
    const accessToken = container.querySelector<HTMLInputElement>('#integration-field-accessToken');
    expect(accessToken?.type).toBe('password');
    expect(siteUrl?.value).toBe('https://example.atlassian.net');
    expect(accessToken?.value).toBe('scoped-token');

    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Connect'
    );
    expect(submit?.disabled).toBe(false);
    await act(async () => {
      submit?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.connect).toHaveBeenCalledWith(
      'jira',
      {
        siteUrl: 'https://example.atlassian.net',
        accessToken: 'scoped-token',
      },
      { accountId: undefined, authMethodId: 'bearer' }
    );
  });

  it('starts with a cancellable method picker before showing Jira fields', async () => {
    await act(async () =>
      root.render(React.createElement(IntegrationSetupModal, { integration: 'jira' }))
    );

    expect(container.textContent).toContain('Connect Jira');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Email + API token',
      'Bearer token',
      'Cancel',
    ]);
    await clickButton('Cancel');
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('keeps the selected account when choosing a method to reconnect Jira', async () => {
    await act(async () =>
      root.render(
        React.createElement(IntegrationSetupModal, {
          integration: 'jira',
          accountId: 'jira-account-2',
        })
      )
    );

    expect(container.textContent).toContain('Reconnect Jira');
    await clickButton('Email + API token');
    await clickButton('Back');
    await clickButton('Bearer token');
    await clickButton('Reconnect');

    expect(mocks.connect).toHaveBeenCalledWith(
      'jira',
      {
        siteUrl: 'https://example.atlassian.net',
        accessToken: 'scoped-token',
      },
      { accountId: 'jira-account-2', authMethodId: 'bearer' }
    );
  });

  it('clears a failed connection when returning to the method picker', async () => {
    mocks.connect.mockResolvedValue({ success: false, error: 'Invalid token' });
    await act(async () =>
      root.render(React.createElement(IntegrationSetupModal, { integration: 'jira' }))
    );

    await clickButton('Bearer token');
    await clickButton('Connect');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid token');
    await clickButton('Back');
    await clickButton('Email + API token');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('passes the same method ID separately when only one named form is available', async () => {
    mocks.singleJiraMethod = true;
    await act(async () =>
      root.render(React.createElement(IntegrationSetupModal, { integration: 'jira' }))
    );

    expect(container.querySelector('#integration-field-accessToken')).not.toBeNull();
    await clickButton('Connect');
    expect(mocks.connect).toHaveBeenCalledWith(
      'jira',
      { siteUrl: 'https://example.atlassian.net', accessToken: 'scoped-token' },
      { accountId: undefined, authMethodId: 'bearer' }
    );
  });
});
