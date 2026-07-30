import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { modalStore } from '@renderer/lib/modal/modal-store';

vi.mock('@renderer/app/modal-registry', () => ({
  modalRegistry: {
    testModal: {
      component: ({ label }: { label: string }) => <div>{label}</div>,
      size: 'sm',
    },
  },
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ModalRenderer', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      modalStore.closeModal();
      root.unmount();
    });
    host.remove();
  });

  it('does not wait for a close animation when removing a modal', async () => {
    await act(async () => {
      root.render(<ModalRenderer />);
      modalStore.setModal('testModal', { label: 'Create task' });
    });

    const popup = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    expect(popup).not.toBeNull();
    expect(popup?.classList).not.toContain('data-closed:animate-out');
    expect(
      document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')?.classList
    ).toContain('data-closed:animate-none');

    const getAnimations = vi.fn(() =>
      popup?.classList.contains('data-closed:animate-out')
        ? [
            {
              finished: new Promise<Animation>(() => {}),
              pending: false,
              playState: 'running',
            } as Animation,
          ]
        : []
    );
    Object.defineProperty(popup, 'getAnimations', { configurable: true, value: getAnimations });

    await act(async () => {
      modalStore.closeModal('completed');
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    expect(modalStore.isOpen).toBe(false);
    expect(getAnimations).toHaveBeenCalled();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });
});
