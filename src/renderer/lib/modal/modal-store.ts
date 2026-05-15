import { makeAutoObservable, observable } from 'mobx';

class ModalStore {
  activeModalId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeModalArgs: Record<string, any> | null = null;
  closeGuardActive = false;
  previousFocus: HTMLElement | null = null;

  constructor() {
    makeAutoObservable(this, {
      activeModalArgs: observable.ref,
      previousFocus: observable.ref,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setModal(id: string, args: Record<string, any>) {
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.activeModalId = id;
    this.activeModalArgs = args;
  }

  closeModal(_outcome: 'completed' | 'dismissed' = 'dismissed') {
    this.closeGuardActive = false;
    this.activeModalId = null;
    this.activeModalArgs = null;
  }

  get isOpen(): boolean {
    return this.activeModalId !== null;
  }
}

export const modalStore = new ModalStore();
