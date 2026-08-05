import type { BrowserWebviewAdapter } from './browser-webview-types';

export type BrowserControls = {
  adapter: BrowserWebviewAdapter | null;
  focusUrl(): void;
  reload(): void;
};

class BrowserControlsRegistry {
  private readonly controls = new Map<string, BrowserControls>();
  private readonly pendingReloads = new Set<string>();

  register(browserId: string, controls: BrowserControls): () => void {
    this.controls.set(browserId, controls);
    if (this.pendingReloads.delete(browserId)) controls.reload();
    return () => {
      if (this.controls.get(browserId) === controls) {
        this.controls.delete(browserId);
      }
    };
  }

  get(browserId: string): BrowserControls | undefined {
    return this.controls.get(browserId);
  }

  reload(browserId: string): void {
    const controls = this.controls.get(browserId);
    if (controls) {
      controls.reload();
      return;
    }
    this.pendingReloads.add(browserId);
  }

  remove(browserId: string): void {
    this.controls.delete(browserId);
    this.pendingReloads.delete(browserId);
  }

  clear(): void {
    this.controls.clear();
    this.pendingReloads.clear();
  }
}

export const browserControlsRegistry = new BrowserControlsRegistry();
