import { err, ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { ModalStore } from './modal-store';

describe('ModalStore', () => {
  it('resolves completed outcomes and closes the modal', async () => {
    const store = new ModalStore();
    const outcome = store.open('confirmModal', { title: 'Continue?' });

    store.complete(true);

    await expect(outcome).resolves.toEqual(ok(true));
    await Promise.resolve();
    expect(store.isOpen).toBe(false);
  });

  it('keeps the dialog open when a resolved modal is replaced in the same turn', async () => {
    const store = new ModalStore();
    const first = store.open('firstModal', {});

    store.complete('done');
    await expect(first).resolves.toEqual(ok('done'));

    const second = store.open('secondModal', {});
    await Promise.resolve();

    expect(store.isOpen).toBe(true);
    expect(store.activeModalId).toBe('secondModal');

    store.dismiss();
    await expect(second).resolves.toEqual(
      err({ type: 'modal_dismissed', reason: 'explicit' })
    );
  });

  it('dismisses the previous outcome when a modal is replaced while still active', async () => {
    const store = new ModalStore();
    const first = store.open('firstModal', {});

    const second = store.open('secondModal', {});

    await expect(first).resolves.toEqual(
      err({ type: 'modal_dismissed', reason: 'replaced' })
    );
    expect(store.activeModalId).toBe('secondModal');

    store.dismiss();
    await expect(second).resolves.toEqual(
      err({ type: 'modal_dismissed', reason: 'explicit' })
    );
  });

  it('reports why an active modal was dismissed', async () => {
    const store = new ModalStore();
    const outcome = store.open('exampleModal', {});

    store.dismiss('navigation');

    await expect(outcome).resolves.toEqual(
      err({ type: 'modal_dismissed', reason: 'navigation' })
    );
  });

  it('consumes the previously focused element once', () => {
    const store = new ModalStore();
    const previousFocus = {} as HTMLElement;
    store.previousFocus = previousFocus;

    expect(store.consumePreviousFocus()).toBe(previousFocus);
    expect(store.consumePreviousFocus()).toBeNull();
  });
});
