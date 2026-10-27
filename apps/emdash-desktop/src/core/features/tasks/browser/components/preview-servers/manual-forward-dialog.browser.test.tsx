import { Dialog } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/features/workbench/api/browser/task-composition-context', () => ({
  usePreviewServers: () => ({ forwardManual: vi.fn() }),
}));

import { ManualForwardDialog } from './manual-forward-dialog';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ManualForwardDialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows a human-readable protocol label instead of its URL scheme value', async () => {
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <ManualForwardDialog onClose={() => {}} />
        </Dialog.Root>
      );
    });

    const trigger = document.body.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    expect(trigger?.textContent?.trim()).toBe('HTTP');

    await act(async () => trigger!.click());
    const httpsOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((item) => item.textContent?.includes('HTTPS'));
    await act(async () => httpsOption!.click());

    expect(trigger?.textContent?.trim()).toBe('HTTPS');
  });
});
