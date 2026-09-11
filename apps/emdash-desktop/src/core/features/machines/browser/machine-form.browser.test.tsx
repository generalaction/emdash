import { Dialog } from '@emdash/ui/react/primitives';
import '@emdash/ui/style.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { SshConfig, SshConfigHost } from '@core/primitives/ssh/api';

const store = vi.hoisted(() => ({
  connections: [] as SshConfig[],
  getSshConfigHosts: vi.fn<() => Promise<SshConfigHost[]>>(),
  getSshConfigHost: vi.fn<(target: string) => Promise<SshConfigHost>>(),
  saveConnection: vi.fn(async () => ({ id: 'saved' })),
  testConnection: vi.fn(async () => ({ success: true })),
}));

vi.mock('@core/features/machines/contributions/app-stores', () => ({
  getMachinesStore: () => store,
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useModalController: () => ({ complete: vi.fn(), dismiss: vi.fn() }),
}));

import { AddMachineModal } from './add-machine-modal';

const resolvedHost: SshConfigHost = {
  host: 'work-dev',
  hostname: 'dev.internal',
  user: 'alice',
  port: 2222,
  identityFile: 'C:/Users/alice/.ssh/id_rsa',
  proxyJump: 'bastion.internal',
};
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  store.connections = [];
  store.getSshConfigHosts.mockResolvedValue([resolvedHost]);
  store.getSshConfigHost.mockImplementation(async (target) => ({ ...resolvedHost, host: target }));
  container = document.createElement('div');
  container.style.width = '440px';
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  flushSync(() => root.unmount());
  queryClient.clear();
  container.remove();
});

async function render(initialConfig?: SshConfig) {
  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Dialog.Root open>
          <Dialog.Content>
            <AddMachineModal initialConfig={initialConfig} dismissControl="close" />
          </Dialog.Content>
        </Dialog.Root>
      </QueryClientProvider>
    )
  );
}

async function selectAuthentication(label: string) {
  await page.getByRole('combobox', { name: 'Authentication', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function resolveTarget(target = 'work-dev') {
  await page.getByRole('combobox', { name: 'Host', exact: true }).fill(target);
  await page.getByText('Resolve', { exact: true }).click();
  await expect.element(page.getByText('Username', { exact: true })).toBeVisible();
}

it('keeps an accessible host name without a visible label and does not open on focus', async () => {
  await render();
  const input = page.getByRole('combobox', { name: 'Host', exact: true });
  await expect.element(page.getByText('Host', { exact: true })).not.toBeInTheDocument();
  await expect.element(input).toHaveAttribute('placeholder', 'Select or enter a host');
  input.element().focus();
  await expect.element(input).toHaveFocus();
  await expect.element(input).toHaveAttribute('aria-expanded', 'false');
  const title = page.getByText('Add SSH Connection', { exact: true });
  await title.click();
  await expect.element(input).not.toHaveFocus();
  await expect.element(input).toHaveAttribute('aria-expanded', 'false');
  await input.click();
  await expect.element(input).toHaveAttribute('aria-expanded', 'true');
  await title.click();
  await expect.element(input).toHaveAttribute('aria-expanded', 'false');
});

it('opens with the input, arrow button, typing, and keyboard without reopening on dismissal', async () => {
  await render();
  const input = page.getByRole('combobox', { name: 'Host', exact: true });
  const trigger = page.getByRole('button', {
    name: 'Show SSH config hosts',
    exact: true,
    includeHidden: true,
  });
  await input.click();
  await expect.element(input).toHaveAttribute('aria-expanded', 'true');
  await userEvent.keyboard('{Escape}');
  await expect.element(input).toHaveAttribute('aria-expanded', 'false');
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(input).toHaveAttribute('aria-expanded', 'true');
  await userEvent.keyboard('{Escape}');
  await input.fill('work');
  await expect.element(input).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('option', { name: /work-dev/ }).click();
  await expect.element(input).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect.element(input).toHaveAttribute('aria-expanded', 'true');
  await trigger.click();
  await expect.element(input).toHaveAttribute('aria-expanded', 'false');
});

it('offers aliases on click, resolves only on Resolve, and saves an inherited key as absent', async () => {
  await render();
  await expect
    .element(
      page.getByText(
        'Choose a host from your SSH config, or enter a hostname. OpenSSH will resolve its connection settings.'
      )
    )
    .toBeVisible();
  await page.getByRole('combobox', { name: 'Host', exact: true }).click();
  await expect
    .element(page.getByText('Hosts from SSH config', { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByRole('separator')).not.toBeInTheDocument();
  await page.getByRole('option', { name: /work-dev/ }).click();
  expect(store.getSshConfigHost).not.toHaveBeenCalled();
  await page.getByText('Resolve', { exact: true }).click();
  await expect.element(page.getByText('Username', { exact: true })).toBeVisible();
  await expect
    .element(page.getByText('From SSH config: work-dev', { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toBeEnabled();
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  const expected = { sshConfigAlias: 'work-dev', privateKeyPath: undefined, host: 'dev.internal' };
  expect(store.testConnection).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(store.saveConnection).toHaveBeenCalledWith(expect.objectContaining(expected));
});

it('explains that an unmatched hostname can still be resolved and waits for the explicit action', async () => {
  let completeLookup!: (value: SshConfigHost) => void;
  store.getSshConfigHost.mockImplementation(
    () =>
      new Promise((resolve) => {
        completeLookup = resolve;
      })
  );
  await render();
  await page.getByRole('combobox', { name: 'Host', exact: true }).fill('new.example.com');
  await expect
    .element(page.getByText('No saved hosts match. You can still resolve this hostname.'))
    .toBeVisible();
  expect(store.getSshConfigHost).not.toHaveBeenCalled();
  await page.getByText('Resolve', { exact: true }).click();
  await expect.poll(() => store.getSshConfigHost.mock.calls.length).toBe(1);
  expect(store.getSshConfigHost).toHaveBeenCalledWith('new.example.com');
  await expect
    .element(page.getByRole('button', { name: 'Resolving…', exact: true }))
    .toBeDisabled();
  completeLookup({ ...resolvedHost, host: 'new.example.com' });
  await expect.element(page.getByText('Username', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Add host', exact: true })).toBeVisible();
});

it('shows resolved settings in the shared form with editable credentials and inherited connection details', async () => {
  store.getSshConfigHost.mockResolvedValue({
    ...resolvedHost,
    proxyCommand: 'ssh bastion -W %h:%p',
    forwardAgent: true,
  });
  await render();
  await resolveTarget();
  await expect
    .element(page.getByRole('combobox', { name: 'Host', exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole('button', { name: 'SSH config', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect
    .element(page.getByRole('textbox', { name: 'Host', exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText('dev.internal', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('spinbutton', { name: 'Port', exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText('2222', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Username', exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText('alice', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .not.toHaveAttribute('readonly');
  await expect.element(page.getByLabelText('Passphrase (optional)', { exact: true })).toBeVisible();
  await page.getByLabelText('Passphrase (optional)', { exact: true }).fill('test-passphrase');
  await expect
    .element(page.getByRole('button', { name: 'Advanced settings', exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole('textbox', { name: 'Jump host', exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText('bastion.internal', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Proxy command', exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText('ssh bastion -W %h:%p', { exact: true })).toBeVisible();
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    await page.getByRole('button', { name: 'Copy jump host', exact: true }).click();
    expect(copy).toHaveBeenCalledWith('bastion.internal');
    const proxyValue = page.getByRole('button', { name: 'Copy proxy command', exact: true });
    expect(getComputedStyle(proxyValue.element()).cursor).toBe('pointer');
    expect(getComputedStyle(proxyValue.element()).userSelect).toBe('none');
    await proxyValue.click();
    expect(copy).toHaveBeenLastCalledWith('ssh bastion -W %h:%p');
    await userEvent.keyboard('{Enter}');
    expect(copy).toHaveBeenCalledTimes(3);
    await page.getByRole('button', { name: 'Copy proxy command', exact: true }).click();
    expect(copy).toHaveBeenCalledWith('ssh bastion -W %h:%p');
    await expect
      .element(page.getByText('Proxy command copied to clipboard.', { exact: true }))
      .toBeInTheDocument();
    copy.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await page.getByRole('button', { name: 'Copy proxy command', exact: true }).click();
    await expect
      .element(page.getByText('Could not copy. Try again.', { exact: true }))
      .toBeVisible();
  } finally {
    copy.mockRestore();
  }
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  expect(store.testConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      sshConfigAlias: 'work-dev',
      passphrase: 'test-passphrase',
      proxyJump: undefined,
    })
  );
  await expect
    .element(page.getByRole('button', { name: 'Change', exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText('From SSH config', { exact: true })).not.toBeInTheDocument();
  await expect
    .element(page.getByText(/These settings follow your SSH config/))
    .not.toBeInTheDocument();
});

it('keeps manual credentials together with a visible passphrase and concise agent guidance', async () => {
  await render();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await selectAuthentication('SSH Key');
  await expect.element(page.getByLabelText('Passphrase (optional)', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Host', exact: true }))
    .not.toHaveAttribute('readonly');
  await selectAuthentication('Agent');
  await expect
    .element(page.getByText('Uses keys available in your SSH agent.', { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByLabelText('Passphrase (optional)', { exact: true }))
    .not.toBeInTheDocument();
});

it('keeps independent connection drafts across tabs, sharing only the name', async () => {
  await render();
  await resolveTarget();
  await page.getByRole('textbox', { name: 'Connection name', exact: true }).fill('Work');
  await page.getByRole('textbox', { name: 'Private key', exact: true }).fill('/keys/config');
  await page.getByLabelText('Passphrase (optional)', { exact: true }).fill('config secret');
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'Host', exact: true })).toHaveValue('');
  await expect
    .element(page.getByRole('textbox', { name: 'Username', exact: true }))
    .toHaveValue('');
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('manual.internal');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('bob');
  await selectAuthentication('SSH Key');
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue('');
  await expect
    .element(page.getByLabelText('Passphrase (optional)', { exact: true }))
    .toHaveValue('');
  await page.getByRole('textbox', { name: 'Private key', exact: true }).fill('/keys/manual');
  await page.getByLabelText('Passphrase (optional)', { exact: true }).fill('manual secret');
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  await page.getByRole('textbox', { name: /^Jump host/ }).fill('manual-bastion');
  await page.getByRole('button', { name: 'SSH config', exact: true }).click();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue('/keys/config');
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  expect(store.testConnection).toHaveBeenLastCalledWith(
    expect.objectContaining({
      name: 'Work',
      sshConfigAlias: 'work-dev',
      privateKeyPath: '/keys/config',
      passphrase: 'config secret',
    })
  );
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect.element(page.getByText('Connected', { exact: true })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole('textbox', { name: 'Host', exact: true }))
    .toHaveValue('manual.internal');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Work',
      host: 'manual.internal',
      username: 'bob',
      sshConfigAlias: undefined,
      privateKeyPath: '/keys/manual',
      passphrase: 'manual secret',
      proxyJump: 'manual-bastion',
    })
  );
});

it('does not validate an unused key after changing authentication to Agent', async () => {
  await render();
  await resolveTarget();
  await page.getByRole('textbox', { name: 'Private key', exact: true }).fill('/keys/invalid ');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveAttribute('aria-invalid', 'true');
  await selectAuthentication('Agent');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      authType: 'agent',
      privateKeyPath: undefined,
    })
  );
});

it('keeps a saved manual draft and its validation errors out of SSH config', async () => {
  await render({
    id: 'existing',
    name: 'Saved',
    host: 'manual.internal',
    port: 2200,
    username: 'bob',
    authType: 'key',
    privateKeyPath: '/keys/manual',
  });
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('invalid host');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .element(page.getByRole('textbox', { name: 'Host', exact: true }))
    .toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'SSH config', exact: true }).click();
  await expect.element(page.getByRole('combobox', { name: 'Host', exact: true })).toHaveValue('');
  await resolveTarget();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue(resolvedHost.identityFile);
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect
    .element(page.getByRole('textbox', { name: 'Host', exact: true }))
    .toHaveValue('invalid host');
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('manual.internal');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'existing',
      name: 'Saved',
      host: 'manual.internal',
      port: 2200,
      username: 'bob',
      privateKeyPath: '/keys/manual',
      sshConfigAlias: undefined,
    })
  );
});

it('does not show a previous tab’s late connection test result', async () => {
  let completeTest!: (value: { success: boolean }) => void;
  const pendingTest = new Promise<{ success: boolean }>((resolve) => {
    completeTest = resolve;
  });
  store.testConnection.mockImplementationOnce(() => pendingTest);
  await render();
  await resolveTarget();
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  completeTest({ success: true });
  await pendingTest;
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('manual.internal');
  await expect.element(page.getByText('Connected', { exact: true })).not.toBeInTheDocument();
  await page.getByRole('button', { name: 'SSH config', exact: true }).click();
  await expect.element(page.getByText('Connected', { exact: true })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole('button', { name: 'Test Connection', exact: true }))
    .toBeEnabled();
});

it('does not carry a key override or an automatic name into a new modal', async () => {
  await render();
  await resolveTarget('first.internal');
  await page.getByRole('textbox', { name: 'Private key', exact: true }).fill('/keys/first_ed25519');
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  flushSync(() => root.render(null));
  await render();
  await resolveTarget('second.internal');
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue(resolvedHost.identityFile);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'second.internal',
      sshConfigAlias: 'second.internal',
      privateKeyPath: undefined,
    })
  );
});

it('ignores a late lookup after switching to manual entry', async () => {
  let completeLookup!: (value: SshConfigHost) => void;
  store.getSshConfigHost.mockImplementation(
    () =>
      new Promise((resolve) => {
        completeLookup = resolve;
      })
  );
  await render();
  await page.getByRole('combobox', { name: 'Host', exact: true }).fill('slow.internal');
  await page.getByText('Resolve', { exact: true }).click();
  await expect.poll(() => store.getSshConfigHost.mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  completeLookup({ ...resolvedHost, host: 'slow.internal' });
  await expect.element(page.getByRole('textbox', { name: 'Host', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('manual.internal');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('manual-user');
  await selectAuthentication('Agent');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      host: 'manual.internal',
      username: 'manual-user',
      port: 22,
      sshConfigAlias: undefined,
    })
  );
  await page.getByRole('button', { name: 'SSH config', exact: true }).click();
  await expect.element(page.getByText('dev.internal', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue(resolvedHost.identityFile);
});

it('rejects unsafe targets before resolution and can retry a failed lookup', async () => {
  await render();
  await page.getByRole('combobox', { name: 'Host', exact: true }).fill('-oProxyCommand=bad');
  await page.getByText('Resolve', { exact: true }).click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Enter a valid SSH config alias or hostname');
  expect(store.getSshConfigHost).not.toHaveBeenCalled();
  store.getSshConfigHost.mockRejectedValueOnce(new Error('Configuration unavailable'));
  await page.getByRole('combobox', { name: 'Host', exact: true }).fill('retry.internal');
  await page.getByText('Resolve', { exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('Configuration unavailable');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.element(page.getByText('Username', { exact: true })).toBeVisible();
});

it('keeps authentication choices when SSH configuration refreshes', async () => {
  await render();
  await resolveTarget('auth.internal');
  await selectAuthentication('Agent');
  await queryClient.invalidateQueries({ queryKey: ['ssh-config-host', 'auth.internal'] });
  await expect
    .element(page.getByRole('combobox', { name: 'Authentication', exact: true }))
    .toHaveTextContent('Agent');
});

it('refreshes the resolved preview and submitted settings without changing either draft', async () => {
  await render();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('manual.internal');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('manual-user');
  await page.getByRole('spinbutton', { name: 'Port', exact: true }).fill('2200');
  await page.getByLabelText('Password', { exact: true }).fill('manual password');
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  await page.getByRole('switch', { name: /^Forward SSH agent/ }).click();
  await page.getByRole('button', { name: 'SSH config', exact: true }).click();
  await resolveTarget();
  await page.getByRole('textbox', { name: 'Private key', exact: true }).fill('/keys/custom');
  await page.getByLabelText('Passphrase (optional)', { exact: true }).fill('config passphrase');
  store.getSshConfigHost.mockResolvedValue({
    ...resolvedHost,
    hostname: 'updated.internal',
    user: 'updated-user',
    port: 2223,
  });
  await queryClient.invalidateQueries({ queryKey: ['ssh-config-host', 'work-dev'] });
  await expect.element(page.getByText('updated.internal', { exact: true })).toBeVisible();
  await expect.element(page.getByText('updated-user', { exact: true })).toBeVisible();
  await expect.element(page.getByText('2223', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  const expected = {
    host: 'updated.internal',
    username: 'updated-user',
    port: 2223,
    privateKeyPath: '/keys/custom',
    passphrase: 'config passphrase',
    sshConfigAlias: 'work-dev',
  };
  expect(store.testConnection).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(store.saveConnection).toHaveBeenCalledWith(expect.objectContaining(expected));
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect
    .element(page.getByLabelText('Password', { exact: true }))
    .toHaveValue('manual password');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(2);
  expect(store.saveConnection).toHaveBeenLastCalledWith(
    expect.objectContaining({
      host: 'manual.internal',
      username: 'manual-user',
      port: 2200,
      authType: 'password',
      password: 'manual password',
      forwardAgent: true,
      sshConfigAlias: undefined,
    })
  );
});

it('keeps a successful Test separate from a failed Save and allows retry', async () => {
  store.saveConnection.mockRejectedValueOnce(new Error('Storage unavailable'));
  await render();
  await resolveTarget();
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.element(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Could not save connection: Storage unavailable');
  await expect.element(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(2);
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
  expect(store.testConnection).toHaveBeenCalledTimes(1);
});

it('shows a duplicate error beside the name when the host fallback already exists', async () => {
  store.connections = [
    {
      id: 'other',
      name: 'duplicate.internal',
      host: 'other',
      port: 22,
      username: 'alice',
      authType: 'agent',
    },
  ];
  await render();
  await resolveTarget('duplicate.internal');
  await expect.element(page.getByRole('button', { name: 'Add host', exact: true })).toBeDisabled();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('An SSH connection with this name already exists');
  expect(store.saveConnection).not.toHaveBeenCalled();
  await page
    .getByRole('textbox', { name: 'Connection name', exact: true })
    .fill('Another connection');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
});

it('resolves a typed target without suggestions and preserves overrides through refetch, Test, and Save', async () => {
  store.getSshConfigHosts.mockResolvedValue([]);
  await render();
  await resolveTarget('build.internal');
  const key = page.getByRole('textbox', { name: 'Private key', exact: true });
  await key.fill('C:/Users/alice/.ssh/id_ed25519');
  await queryClient.invalidateQueries({ queryKey: ['ssh-config-host', 'build.internal'] });
  await expect.element(key).toHaveValue('C:/Users/alice/.ssh/id_ed25519');
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  const expected = {
    sshConfigAlias: 'build.internal',
    privateKeyPath: 'C:/Users/alice/.ssh/id_ed25519',
  };
  expect(store.testConnection).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(store.saveConnection).toHaveBeenCalledWith(expect.objectContaining(expected));
});

it('retains a saved override on edit and can reset it to SSH config', async () => {
  await render({
    id: 'existing',
    name: 'Work',
    host: 'dev.internal',
    port: 22,
    username: 'alice',
    authType: 'key',
    sshConfigAlias: 'work-dev',
    privateKeyPath: 'C:/Users/alice/.ssh/id_ed25519',
  });
  await expect.element(page.getByText('Username', { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue('C:/Users/alice/.ssh/id_ed25519');
  await page.getByRole('button', { name: 'Reset to SSH config' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({ privateKeyPath: undefined })
  );
});

it('tests edits with the saved ID and only offers password retention for the same destination', async () => {
  await render({
    id: 'saved-password',
    name: 'Work',
    host: 'work.internal',
    port: 22,
    username: 'alice',
    authType: 'password',
  });
  const password = page.getByLabelText('Password', { exact: true });
  await expect.element(password).toHaveValue('');
  await expect.element(password).toHaveAttribute('placeholder', 'Leave blank to keep existing');
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
  expect(store.testConnection).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'saved-password', host: 'work.internal', password: '' })
  );
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('another.internal');
  await expect.element(password).not.toHaveAttribute('placeholder', 'Leave blank to keep existing');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.element(password).toHaveAttribute('aria-invalid', 'true');
  expect(store.saveConnection).not.toHaveBeenCalled();
  await password.fill('new secret');
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect.poll(() => store.testConnection.mock.calls.length).toBe(2);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  const expected = { id: 'saved-password', host: 'another.internal', password: 'new secret' };
  expect(store.testConnection).toHaveBeenLastCalledWith(expect.objectContaining(expected));
  expect(store.saveConnection).toHaveBeenLastCalledWith(expect.objectContaining(expected));
});

it('only offers passphrase retention for the saved key and requires a password when switching auth', async () => {
  await render({
    id: 'saved-key',
    name: 'Work',
    host: 'work.internal',
    port: 22,
    username: 'alice',
    authType: 'key',
    privateKeyPath: '/keys/old',
  });
  const passphrase = page.getByLabelText('Passphrase (optional)', { exact: true });
  await expect
    .element(passphrase)
    .toHaveAttribute('placeholder', 'Leave blank to reuse if verified');
  await page.getByRole('textbox', { name: 'Private key', exact: true }).fill('/keys/new');
  await expect.element(passphrase).toHaveAttribute('placeholder', 'Optional');
  await selectAuthentication('Password');
  const password = page.getByLabelText('Password', { exact: true });
  await expect.element(password).not.toHaveAttribute('placeholder', 'Leave blank to keep existing');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.element(password).toHaveAttribute('aria-invalid', 'true');
  expect(store.saveConnection).not.toHaveBeenCalled();
});

it('shows a legacy passphrase re-entry request and lets the user retry without losing the draft', async () => {
  await render({
    id: 'legacy-key',
    name: 'Work',
    host: 'work.internal',
    port: 22,
    username: 'alice',
    authType: 'key',
    privateKeyPath: '/keys/work',
  });
  store.saveConnection.mockRejectedValueOnce(
    new Error(
      'Re-enter your SSH key passphrase once to verify it for this key. Your saved passphrase has not been changed.'
    )
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Re-enter your SSH key passphrase');
  await expect
    .element(page.getByRole('textbox', { name: 'Private key', exact: true }))
    .toHaveValue('/keys/work');
  await expect
    .element(page.getByRole('textbox', { name: 'Host', exact: true }))
    .toHaveValue('work.internal');
  await page.getByLabelText('Passphrase (optional)', { exact: true }).fill('re-entered passphrase');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(2);
  expect(store.saveConnection).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: 'legacy-key',
      privateKeyPath: '/keys/work',
      passphrase: 're-entered passphrase',
    })
  );
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

it('keeps resolution failures visible and offers an explicit manual path', async () => {
  store.getSshConfigHost.mockRejectedValue(new Error('Could not read SSH configuration'));
  await render();
  await page.getByRole('combobox', { name: 'Host', exact: true }).fill('example.test');
  await page.getByText('Resolve', { exact: true }).click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Could not read SSH configuration');
  expect(store.testConnection).not.toHaveBeenCalled();
  expect(store.saveConnection).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'Host', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('example.test');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('alice');
  await selectAuthentication('Agent');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
  expect(store.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      host: 'example.test',
      sshConfigAlias: undefined,
      authType: 'agent',
    })
  );
});

it.each(['config', 'manual'] as const)(
  'uses an optional name in %s mode and returns to the host when cleared',
  async (mode) => {
    await render();
    await expect
      .element(page.getByRole('button', { name: 'SSH config', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    const name = page.getByRole('textbox', { name: 'Connection name', exact: true });
    await name.fill('My workstation');
    if (mode === 'manual') {
      await page.getByRole('button', { name: 'Manual', exact: true }).click();
      await page.getByRole('textbox', { name: 'Host', exact: true }).fill('manual.internal');
      await page.getByRole('textbox', { name: 'Username', exact: true }).fill('alice');
      await selectAuthentication('Agent');
    } else {
      await resolveTarget('config.internal');
    }
    await expect.element(name).toHaveValue('My workstation');
    await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect.poll(() => store.testConnection.mock.calls.length).toBe(1);
    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My workstation' })
    );
    await name.fill('');
    await page.getByRole('button', { name: 'Add host', exact: true }).click();
    await expect.poll(() => store.saveConnection.mock.calls.length).toBe(1);
    expect(store.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: mode === 'manual' ? 'manual.internal' : 'config.internal',
      })
    );
    await expect.element(name).toHaveValue('');
  }
);

it('shows manual routing under Advanced settings and keeps the name across source switches', async () => {
  await render();
  const name = page.getByRole('textbox', { name: 'Connection name', exact: true });
  await name.fill('My server');
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: /^Jump host/ })).toBeVisible();
  await expect.element(name).toHaveValue('My server');
  await page.getByRole('button', { name: 'SSH config', exact: true }).click();
  await expect.element(name).toHaveValue('My server');
  await expect.element(page.getByRole('combobox', { name: 'Host', exact: true })).toBeVisible();
});
