import { makeAutoObservable, observable } from 'mobx';

class ModalStore {
  activeModalId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeModalArgs: Record<string, any> | null = null;
  closeGuardActive = false;

  constructor() {
    makeAutoObservable(this, {
      activeModalArgs: observable.ref,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setModal(id: string, args: Record<string, any>) {
    this.activeModalId = id;
    this.activeModalArgs = args;
  }

  closeModal(_outcome: 'completed' | 'dismissed' = 'dismissed') {
    this.closeGuardActive = false;
    this.activeModalId = null;
    this.activeModalArgs = null;
    window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open: false } }));
  }

  get isOpen(): boolean {
    return this.activeModalId !== null;
  }
}

export const modalStore = new ModalStore();
