import { ComboboxPopup } from '@emdash/ui/react/primitives';
import '@emdash/ui/style.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ComboboxPopup layout', () => {
  let host: HTMLDivElement;
  let root: Root;
  let focusTarget: HTMLDivElement | null = null;

  beforeEach(() => {
    focusTarget = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    focusTarget?.remove();
    host.remove();
  });

  async function renderPopup(anchorRect: DOMRect): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <ComboboxPopup
          wide
          items={[{ id: 'file', label: 'long-file-name.tsx' }]}
          anchorRect={anchorRect}
          onSelect={vi.fn()}
        />
      );
    });

    const popup = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(popup).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return popup!;
  }

  it('keeps a wide popup inside the viewport near the right edge', async () => {
    const gutter = 8;
    const popup = await renderPopup(
      new DOMRect(window.innerWidth - gutter, window.innerHeight / 2, 0, 0)
    );
    const bounds = popup.getBoundingClientRect();

    expect(bounds.left).toBeGreaterThanOrEqual(gutter);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - gutter);
  });

  it('flips above the caret when there is not enough space below', async () => {
    const gutter = 8;
    const anchorRect = new DOMRect(100, window.innerHeight - gutter, 0, 0);
    const popup = await renderPopup(anchorRect);
    const bounds = popup.getBoundingClientRect();

    expect(popup.dataset.side).toBe('top');
    expect(bounds.top).toBeGreaterThanOrEqual(gutter);
    expect(bounds.bottom).toBeLessThanOrEqual(anchorRect.top - 4);
  });

  it('does not move focus from the editor when it opens', async () => {
    focusTarget = document.createElement('div');
    focusTarget.contentEditable = 'true';
    document.body.appendChild(focusTarget);
    focusTarget.focus();
    expect(document.activeElement).toBe(focusTarget);

    await renderPopup(new DOMRect(100, 100, 0, 0));

    expect(document.activeElement).toBe(focusTarget);
  });
});
