import { action, makeObservable, observable } from 'mobx';

/**
 * Observable entry for a single browser tab.
 * Owned by PaneStore; its identity fields are persisted via the browser TabProvider.
 */
export class BrowserTabEntry {
  readonly kind = 'browser' as const;
  readonly tabId: string;
  readonly browserId: string;
  isPreview: boolean;

  constructor(browserId: string, isPreview: boolean, tabId?: string) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.browserId = browserId;
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
