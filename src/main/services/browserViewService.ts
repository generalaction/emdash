import { BrowserWindow, WebContentsView, app } from 'electron';
import { getMainWindow } from '../app/window';

class BrowserViewService {
  private view: WebContentsView | null = null;
  private visible = false;

  ensureView(win?: BrowserWindow): WebContentsView | null {
    const w = win || getMainWindow() || undefined;
    if (!w) return null;
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      w.contentView.addChildView(this.view);
      try {
        this.view.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }) as any);
      } catch {}
      this.visible = true;
    }
    return this.view;
  }

  show(bounds: Electron.Rectangle, url?: string) {
    const win = getMainWindow() || undefined;
    const v = this.ensureView(win);
    if (!v) return;
    v.setBounds(bounds);
    try {
      // Keep rendering even when not focused/visible previously
      v.webContents.setBackgroundThrottling?.(false as any);
    } catch {}
    if (url) {
      try {
        const current = (() => {
          try {
            return v.webContents.getURL();
          } catch {
            return '';
          }
        })();
        if (!current || current !== url) {
          v.webContents.loadURL(url);
        }
      } catch {}
    }
    try {
      v.webContents.focus();
    } catch {}
    // Nudge paint on some platforms: re-apply bounds on next tick
    try {
      setTimeout(() => {
        try {
          v.setBounds(bounds);
        } catch {}
      }, 16);
    } catch {}
    this.visible = true;
  }

  hide() {
    if (!this.view) return;
    try {
      // Move offscreen instead of removing to keep state
      this.view.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });
    } catch {}
    this.visible = false;
  }

  setBounds(bounds: Electron.Rectangle) {
    if (!this.view) return;
    try {
      this.view.setBounds(bounds);
    } catch {}
  }

  loadURL(url: string) {
    const v = this.ensureView();
    if (!v) return;
    try {
      v.webContents.loadURL(url);
    } catch {}
  }

  goBack() {
    try {
      this.view?.webContents.goBack();
    } catch {}
  }
  goForward() {
    try {
      this.view?.webContents.goForward();
    } catch {}
  }
  reload() {
    try {
      this.view?.webContents.reload();
    } catch {}
  }

  isVisible(): boolean {
    return this.visible;
  }
}

export const browserViewService = new BrowserViewService();
