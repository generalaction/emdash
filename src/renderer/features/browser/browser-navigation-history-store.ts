type BrowserNavigationHistoryState = {
  entries: string[];
  index: number;
};

export class BrowserNavigationHistoryStore {
  private readonly histories = new Map<string, BrowserNavigationHistoryState>();

  recordNavigation(browserId: string, url: string): void {
    const existing = this.histories.get(browserId);
    if (!existing) {
      this.histories.set(browserId, { entries: [url], index: 0 });
      return;
    }

    if (existing.entries[existing.index] === url) return;

    const previousIndex = existing.index - 1;
    if (existing.entries[previousIndex] === url) {
      existing.index = previousIndex;
      return;
    }

    const nextIndex = existing.index + 1;
    if (existing.entries[nextIndex] === url) {
      existing.index = nextIndex;
      return;
    }

    existing.entries.splice(existing.index + 1);
    existing.entries.push(url);
    existing.index = existing.entries.length - 1;
  }

  canGoBack(browserId: string): boolean {
    const history = this.histories.get(browserId);
    return history ? history.index > 0 : false;
  }

  canGoForward(browserId: string): boolean {
    const history = this.histories.get(browserId);
    return history ? history.index < history.entries.length - 1 : false;
  }

  goBack(browserId: string): string | null {
    const history = this.histories.get(browserId);
    if (!history || history.index <= 0) return null;
    history.index -= 1;
    return history.entries[history.index];
  }

  goForward(browserId: string): string | null {
    const history = this.histories.get(browserId);
    if (!history || history.index >= history.entries.length - 1) return null;
    history.index += 1;
    return history.entries[history.index];
  }

  remove(browserId: string): void {
    this.histories.delete(browserId);
  }

  clear(): void {
    this.histories.clear();
  }
}

export const browserNavigationHistoryStore = new BrowserNavigationHistoryStore();
