import { makeAutoObservable } from 'mobx';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

class ModalStore {
  activeModalId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeModalArgs: Record<string, any> | null = null;
  closeGuardActive = false;
  private openedAtMs: number | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setModal(id: string, args: Record<string, any>) {
    if (this.activeModalId && this.openedAtMs !== null) {
      captureTelemetry('modal_closed', {
        modal_id: this.activeModalId,
        outcome: 'dismissed',
        duration_ms: Math.max(0, Date.now() - this.openedAtMs),
      });
    }

    this.activeModalId = id;
    this.activeModalArgs = args;
    this.openedAtMs = Date.now();

    captureTelemetry('modal_opened', { modal_id: id });
    focusTracker.transition({}, 'modal_open');
  }

  closeModal(outcome: 'completed' | 'dismissed' = 'dismissed') {
    if (this.activeModalId) {
      captureTelemetry('modal_closed', {
        modal_id: this.activeModalId,
        outcome,
        duration_ms: Math.max(0, Date.now() - (this.openedAtMs ?? Date.now())),
      });
      focusTracker.transition({}, 'modal_close');
    }

    this.closeGuardActive = false;
    this.activeModalId = null;
    this.activeModalArgs = null;
    this.openedAtMs = null;
    window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open: false } }));
  }

  get isOpen(): boolean {
    return this.activeModalId !== null;
  }
}

export const modalStore = new ModalStore();
