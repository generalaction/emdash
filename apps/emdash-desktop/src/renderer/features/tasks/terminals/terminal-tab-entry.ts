import { action, makeObservable, observable } from 'mobx';

/**
 * Observable entry for a task-pane terminal tab.
 * The terminal runtime itself is owned by TerminalManagerStore; this entry only
 * points at the task-scoped terminal record.
 */
export class TerminalTabEntry {
  readonly kind = 'terminal' as const;
  readonly tabId: string;
  readonly terminalId: string;
  isPreview: boolean;

  constructor(terminalId: string, isPreview: boolean, tabId?: string) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.terminalId = terminalId;
    this.isPreview = isPreview;
    makeObservable(this, {
      isPreview: observable,
      pin: action,
    });
  }

  pin(): void {
    this.isPreview = false;
  }
}
