// @vitest-environment jsdom
import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostTrustPrompt } from '@core/services/ssh/api/host-trust';

const controller = vi.hoisted(() => ({ complete: vi.fn(), dismiss: vi.fn() }));
vi.mock('@core/manifests/browser/modal-api', () => ({ useModalController: () => controller }));
// These tests exercise modal decisions without browser layout; the browser suite uses the real kit.
vi.mock('@emdash/ui/react/primitives', async () => {
  const { createElement: h, Fragment } = await import('react');
  const section = ({ children }: { children?: ReactNode }) => h('section', null, children);
  return {
    Button: ({
      variant: _variant,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => h('button', props),
    Checkbox: ({
      checked,
      onCheckedChange,
    }: {
      checked: boolean;
      onCheckedChange(checked: boolean): void;
    }) =>
      h('input', {
        type: 'checkbox',
        checked,
        onChange: (event: { target: HTMLInputElement }) => onCheckedChange(event.target.checked),
      }),
    Dialog: { Header: section, Title: section, Body: section, Footer: section },
    ModalLayout: ({
      header,
      footer,
      children,
    }: {
      header: ReactNode;
      footer: ReactNode;
      children: ReactNode;
    }) => h(Fragment, null, header, children, footer),
  };
});
import { HostTrustModal } from './host-trust-modal';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(prompt: HostTrustPrompt, signal = new AbortController().signal) {
  await act(async () => root.render(createElement(HostTrustModal, { prompt, signal })));
}
function button(text: string) {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === text
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

it('shows both fingerprints and cannot approve replacement before verification', async () => {
  await render({
    kind: 'changed',
    destination: 'work',
    host: 'work',
    knownHostsFile: '/keys/known_hosts',
    previousFingerprints: ['SHA256:old'],
    fingerprint: 'SHA256:new',
  });
  expect(container.textContent).toContain('SHA256:old');
  expect(container.textContent).toContain('SHA256:new');
  const replace = button('Replace key and reconnect');
  expect(replace.disabled).toBe(true);
  await act(async () => replace.click());
  expect(controller.complete).not.toHaveBeenCalled();
  const checkbox = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  await act(async () => checkbox.click());
  expect(replace.disabled).toBe(false);
  await act(async () => replace.click());
  expect(controller.complete).toHaveBeenCalledWith(true);
});

it('requires an explicit choice for a new host and makes Cancel dismiss it', async () => {
  await render({ kind: 'unknown', destination: 'work', prompt: 'ED25519 SHA256:new' });
  expect(controller.complete).not.toHaveBeenCalled();
  await act(async () => button('Cancel').click());
  expect(controller.dismiss).toHaveBeenCalledOnce();
  await act(async () => button('Trust and connect').click());
  expect(controller.complete).toHaveBeenCalledWith(true);
});

it('dismisses on connection cancellation and ignores clicks on a stale modal', async () => {
  const abort = new AbortController();
  await render({ kind: 'unknown', destination: 'work', prompt: 'SHA256:new' }, abort.signal);
  abort.abort();
  expect(controller.dismiss).toHaveBeenCalledOnce();
  await act(async () => button('Trust and connect').click());
  expect(controller.complete).not.toHaveBeenCalled();
});

it('dismisses a request canceled before the modal mounts', async () => {
  await render({ kind: 'unknown', destination: 'work', prompt: 'SHA256:new' }, AbortSignal.abort());
  expect(controller.dismiss).toHaveBeenCalledOnce();
  expect(button('Trust and connect').disabled).toBe(true);
});
