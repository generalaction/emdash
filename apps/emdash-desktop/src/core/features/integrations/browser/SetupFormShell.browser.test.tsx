import { Dialog, Input } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@emdash/ui/style.css';

vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    connectIntegration: vi.fn(),
    isIntegrationMutating: () => false,
  }),
}));

import { SetupFormShell } from './SetupFormShell';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('SetupFormShell', () => {
  let host: HTMLDivElement;
  let root: Root;
  let utilityStyles: HTMLStyleElement;

  beforeEach(() => {
    utilityStyles = document.createElement('style');
    utilityStyles.textContent = `
      @layer utilities {
        .pt-1 { padding-top: 0.25rem; }
      }
    `;
    document.head.append(utilityStyles);

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    utilityStyles.remove();
  });

  it('keeps the focused input ring inside the dialog scroll viewport', async () => {
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Connect integration</Dialog.Title>
            </Dialog.Header>
            <SetupFormShell
              providerId="linear"
              getInput={() => ({})}
              canSubmit={false}
              onSuccess={vi.fn()}
              onClose={vi.fn()}
            >
              <Input autoFocus placeholder="Linear API key *" />
            </SetupFormShell>
          </Dialog.Content>
        </Dialog.Root>
      );
    });

    const input = document.body.querySelector<HTMLInputElement>('[data-slot="input"]');
    const viewport = input?.closest<HTMLElement>('.scroll-fade__viewport');
    expect(input).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await vi.waitFor(() => {
      expect(getComputedStyle(input!).boxShadow).toMatch(/0px 0px 0px 3px/);
    });
    expect(
      input!.getBoundingClientRect().top - viewport!.getBoundingClientRect().top
    ).toBeGreaterThanOrEqual(3);
  });
});
