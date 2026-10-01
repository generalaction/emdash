import { Dialog } from '@emdash/ui/react/primitives';
import '@emdash/ui/style.css';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { HostTrustPrompt } from '@core/services/ssh/api/host-trust';

const modal = vi.hoisted(() => ({ complete: vi.fn(), dismiss: vi.fn() }));
vi.mock('@core/manifests/browser/modal-api', () => ({ useModalController: () => modal }));
import { HostTrustModal } from './host-trust-modal';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function render(prompt: HostTrustPrompt, signal = new AbortController().signal) {
  flushSync(() =>
    root.render(
      <Dialog.Root open>
        <Dialog.Content>
          <HostTrustModal prompt={prompt} signal={signal} />
        </Dialog.Content>
      </Dialog.Root>
    )
  );
}

it('shows the OpenSSH fingerprint and requires an explicit trust action', async () => {
  render({
    kind: 'unknown',
    destination: 'work',
    prompt: 'ED25519 key fingerprint is SHA256:example.',
  });
  await expect.element(page.getByText('ED25519 key fingerprint is SHA256:example.')).toBeVisible();
  expect(modal.complete).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Trust and connect', exact: true }).click();
  expect(modal.complete).toHaveBeenCalledWith(true);
});

it('requires out-of-band verification before replacing a changed key', async () => {
  render({
    kind: 'changed',
    destination: 'work',
    host: '[work]:2222',
    knownHostsFile: '/home/alice/.ssh/known_hosts',
    previousFingerprints: ['SHA256:old'],
    fingerprint: 'SHA256:new',
  });
  await expect.element(page.getByText('SHA256:old', { exact: true })).toBeVisible();
  await expect.element(page.getByText('SHA256:new', { exact: true })).toBeVisible();
  const replace = page.getByRole('button', { name: 'Replace key and reconnect', exact: true });
  await expect.element(replace).toBeDisabled();
  await page.getByRole('checkbox').click();
  await expect.element(replace).toBeEnabled();
  await replace.click();
  expect(modal.complete).toHaveBeenCalledWith(true);
});

it('cancels without approving and closes when the connection is canceled', async () => {
  const controller = new AbortController();
  render({ kind: 'unknown', destination: 'work', prompt: 'SHA256:example' }, controller.signal);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(modal.dismiss).toHaveBeenCalled();
  controller.abort();
  expect(modal.dismiss).toHaveBeenCalledTimes(2);
  expect(modal.complete).not.toHaveBeenCalled();
});
