import { err, ok, type Result } from '@emdash/shared';
import { makeAutoObservable, observable } from 'mobx';
import type { ModalDismissed, ModalDismissReason } from '@core/primitives/modals/react';

interface Deferred<T> {
  readonly promise: Promise<T>;
  settled: boolean;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const deferred: Deferred<T> = {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
    settled: false,
    resolve(value) {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise(value);
    },
  };
  return deferred;
}

export class ModalStore {
  activeModalId: string | null = null;
  activeModalArgs: Record<string, unknown> | null = null;
  closeGuardActive = false;
  previousFocus: HTMLElement | null = null;
  private pendingOpen: Deferred<Result<unknown, ModalDismissed>> | null = null;
  private closeScheduled = false;
  private closeSequence = 0;

  constructor() {
    makeAutoObservable<this, 'pendingOpen' | 'closeScheduled' | 'closeSequence'>(this, {
      activeModalArgs: observable.ref,
      previousFocus: observable.ref,
      pendingOpen: false,
      closeScheduled: false,
      closeSequence: false,
    });
  }

  open(id: string, props: unknown): Promise<Result<unknown, ModalDismissed>> {
    const pendingOpen = createDeferred<Result<unknown, ModalDismissed>>();
    this.activateModal(id, props as Record<string, unknown>, pendingOpen);
    return pendingOpen.promise;
  }

  complete(result: unknown): void {
    if (!this.isOpen || this.closeScheduled) return;
    this.pendingOpen?.resolve(ok(result));
    this.pendingOpen = null;
    this.scheduleClose();
  }

  dismiss(reason: ModalDismissReason = 'explicit'): void {
    if (!this.isOpen || this.closeScheduled) return;
    this.pendingOpen?.resolve(err<ModalDismissed>({ type: 'modal_dismissed', reason }));
    this.pendingOpen = null;
    this.scheduleClose();
  }

  setCloseGuard(active: boolean): void {
    this.closeGuardActive = active;
  }

  consumePreviousFocus(): HTMLElement | null {
    const previousFocus = this.previousFocus;
    this.previousFocus = null;
    return previousFocus;
  }

  get isOpen(): boolean {
    return this.activeModalId !== null;
  }

  private activateModal(
    id: string,
    args: Record<string, unknown>,
    pendingOpen: Deferred<Result<unknown, ModalDismissed>>
  ): void {
    if (this.closeScheduled) {
      this.closeScheduled = false;
      this.closeSequence += 1;
    } else if (this.isOpen) {
      this.pendingOpen?.resolve(
        err<ModalDismissed>({ type: 'modal_dismissed', reason: 'replaced' })
      );
    } else if (typeof document !== 'undefined') {
      this.previousFocus = document.activeElement as HTMLElement | null;
    }

    this.closeGuardActive = false;
    this.activeModalId = id;
    this.activeModalArgs = args;
    this.pendingOpen = pendingOpen;
  }

  private scheduleClose(): void {
    this.closeGuardActive = false;
    this.closeScheduled = true;
    const closeSequence = ++this.closeSequence;
    queueMicrotask(() => this.finalizeClose(closeSequence));
  }

  private finalizeClose(closeSequence: number): void {
    if (!this.closeScheduled || this.closeSequence !== closeSequence) return;

    this.closeScheduled = false;
    this.activeModalId = null;
    this.activeModalArgs = null;
    this.pendingOpen = null;
  }
}

export const modalStore = new ModalStore();
