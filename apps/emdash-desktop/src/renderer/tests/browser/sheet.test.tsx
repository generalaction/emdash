import '@emdash/ui/style.css';
import { Sheet } from '@emdash/ui/react/primitives';
import { act, useState, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function AgentSheetHarness() {
  const [agentId, setAgentId] = useState<string | null>(null);
  return (
    <>
      <header
        data-testid="titlebar"
        style={
          {
            position: 'fixed',
            inset: '0 0 auto',
            height: 40,
            WebkitAppRegion: 'drag',
          } as CSSProperties
        }
      />
      <button style={{ marginTop: 80 }} onClick={() => setAgentId('codex')}>
        Codex
      </button>
      <Sheet.Root open={agentId !== null} onOpenChange={(open) => !open && setAgentId(null)}>
        <Sheet.Content side="right">
          <Sheet.Header>
            <Sheet.Title>Agent Settings</Sheet.Title>
          </Sheet.Header>
          <Sheet.Body>{agentId}</Sheet.Body>
        </Sheet.Content>
      </Sheet.Root>
    </>
  );
}

describe('Sheets over desktop window chrome', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<AgentSheetHarness />));
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('excludes the panel and backdrop from native window dragging', async () => {
    const close = page.getByRole('button', { name: 'Close', exact: true });
    await expect.element(close).toBeVisible();

    const titlebar = host.querySelector('[data-testid="titlebar"]')!;
    const content = document.querySelector('[data-slot="sheet-content"]')!;
    const backdrop = document.querySelector('[data-slot="sheet-backdrop"]')!;
    const buttonBounds = close.element().getBoundingClientRect();
    expect(buttonBounds.top).toBeLessThan(titlebar.getBoundingClientRect().bottom);
    expect(getComputedStyle(titlebar).getPropertyValue('-webkit-app-region')).toBe('drag');

    // Browser clicks bypass Electron's native drag hit testing. Verify the CSS
    // exclusion as well as dismissal so a working React handler cannot mask it.
    expect(getComputedStyle(content).getPropertyValue('-webkit-app-region')).toBe('no-drag');
    expect(getComputedStyle(backdrop).getPropertyValue('-webkit-app-region')).toBe('no-drag');
  });

  it('closes with the X and can reopen the same agent', async () => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
  });

  it('closes when the backdrop is clicked over the title bar', async () => {
    await page.elementLocator(document.querySelector('[data-slot="sheet-backdrop"]')!).click({
      position: { x: 10, y: 10 },
    });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="sheet-backdrop"]')).toBeNull();
  });

  it('still closes with Escape', async () => {
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });
});
