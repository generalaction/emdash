import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseNativeAbsolute } from '@emdash/core/primitives/path/api';
import { Dialog } from '@emdash/ui/react/primitives';
import { observable, runInAction } from 'mobx';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LanguageStatus, languageServicesDialog } from './language-status';
import type { MonacoLanguageServices } from './monaco-language-services';
import '@emdash/ui/style.css';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./language-services', () => ({ getLanguageServices: mock.get }));
beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(fallbackAvailable: boolean, dialog = false) {
  const status = observable.box<ReturnType<MonacoLanguageServices['status']>>(
    {
      serverName: fallbackAvailable ? 'TypeScript / JavaScript' : 'Python',
      fallbackAvailable,
      connection: { kind: 'disconnected', message: 'Server is not installed' },
    },
    { deep: false }
  );
  const restartServer = vi.fn(async () => {});
  mock.get.mockReturnValue({ status: () => status.get(), restartServer });
  const parsed = parseNativeAbsolute('/workspace/a.ts');
  if (!parsed.success) throw new Error('Invalid fixture path');
  const file = hostFileRef(LOCAL_HOST_REF, parsed.data);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanup.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const Details = languageServicesDialog.component;
  await act(async () =>
    root.render(
      dialog ? (
        <Dialog.Root open>
          <Dialog.Content size="sm">
            <Details file={file} />
          </Dialog.Content>
        </Dialog.Root>
      ) : (
        <LanguageStatus file={file} />
      )
    )
  );
  return { status, container, file, restartServer };
}

it('shows basic support, retries the host, and updates when full services recover', async () => {
  const f = await fixture(true);
  const button = f.container.querySelector('button');
  expect(button?.textContent).toBe('Retry');
  expect(f.container.textContent).toContain('Basic support is available for loaded files');
  await act(async () => button?.click());
  expect(f.restartServer).toHaveBeenCalledWith(f.file);
  await act(async () =>
    runInAction(() =>
      f.status.set({
        serverName: 'TypeScript / JavaScript',
        fallbackAvailable: true,
        connection: {
          kind: 'connected',
          server: {
            phase: 'ready',
            generation: 'one',
            diagnostics: [],
            capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
          },
        },
      })
    )
  );
  expect(button?.textContent).toBe('Restart language services');
  expect(f.container.textContent).toContain('Language services are ready');
});

it('shows unavailable services for languages without a Monaco fallback', async () => {
  const f = await fixture(false);
  expect(f.container.textContent).toContain('Language services unavailable.');
});

it('shows troubleshooting in the file-menu dialog', async () => {
  await fixture(true, true);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.element(page.getByRole('heading', { name: 'Language services' })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});
