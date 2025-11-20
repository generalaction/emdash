import { BrowserWindow, WebContentsView } from 'electron';
import { getMainWindow } from '../app/window';

class BrowserViewService {
  private view: WebContentsView | null = null;
  private visible = false;
  private emitToRenderers(evt: any) {
    try {
      const wins = BrowserWindow.getAllWindows();
      for (const w of wins) {
        try {
          w.webContents.send('browser:view:event', evt);
        } catch {}
      }
    } catch {}
  }

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
      try {
        this.view.webContents.on('did-finish-load', () =>
          this.emitToRenderers({ type: 'did-finish-load' })
        );
        this.view.webContents.on('did-fail-load', (_ev, errorCode, errorDescription) =>
          this.emitToRenderers({ type: 'did-fail-load', errorCode, errorDescription })
        );
        this.view.webContents.on('did-start-navigation', (_ev, url) =>
          this.emitToRenderers({ type: 'did-start-navigation', url })
        );
      } catch {}
      this.visible = true;
    }
    return this.view;
  }

  // Clear the current URL when switching worktrees
  clear() {
    if (!this.view) return;
    try {
      // Load about:blank to clear the current page
      this.view.webContents.loadURL('about:blank');
    } catch {}
  }

  private bringToFront(win: BrowserWindow) {
    if (!this.view) return;
    try {
      // Remove and re-add the view to bring it to the front
      // In Electron, views added later are rendered on top
      win.contentView.removeChildView(this.view);
      win.contentView.addChildView(this.view);
    } catch {}
  }

  show(bounds: Electron.Rectangle, url?: string) {
    const win = getMainWindow() || undefined;
    if (!win) return;

    const v = this.ensureView(win);
    if (!v) return;

    // Ensure bounds are valid (width and height must be > 0)
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    // Bring view to front to ensure it renders above other content
    this.bringToFront(win);

    // Set bounds first to ensure view is positioned correctly
    v.setBounds(bounds);

    try {
      // Keep rendering even when not focused/visible previously
      v.webContents.setBackgroundThrottling?.(false as any);
    } catch {}

    // Load URL immediately when provided
    if (url) {
      try {
        const current = (() => {
          try {
            return v.webContents.getURL();
          } catch {
            return '';
          }
        })();
        // Normalize URLs for comparison (remove trailing slashes, etc.)
        const normalizeUrl = (u: string) => u.replace(/\/$/, '').toLowerCase();
        const normalizedCurrent = current ? normalizeUrl(current) : '';
        const normalizedUrl = normalizeUrl(url);

        if (!current || normalizedCurrent !== normalizedUrl) {
          // Load URL immediately - don't delay
          try {
            v.webContents.loadURL(url);
          } catch (e) {
            // If immediate load fails, try again after a short delay
            setTimeout(() => {
              try {
                v.webContents.loadURL(url);
              } catch {}
            }, 50);
          }
        }
      } catch {}
    }

    // Ensure view is visible and focused
    try {
      v.webContents.focus();
    } catch {}

    // Force bounds update after a short delay to ensure view is positioned correctly
    // This helps with timing issues where the container might not be fully laid out yet
    try {
      setTimeout(() => {
        try {
          const updatedBounds = { ...bounds };
          // Re-validate bounds before setting
          if (updatedBounds.width > 0 && updatedBounds.height > 0) {
            v.setBounds(updatedBounds);
            // Bring to front again after bounds update
            this.bringToFront(win);
            // Ensure URL is still loaded after bounds update
            if (url) {
              try {
                const current = v.webContents.getURL();
                const normalizeUrl = (u: string) => u.replace(/\/$/, '').toLowerCase();
                if (!current || normalizeUrl(current) !== normalizeUrl(url)) {
                  v.webContents.loadURL(url);
                }
              } catch {}
            }
            // Force focus again after bounds update
            v.webContents.focus();
          }
        } catch {}
      }, 50);
    } catch {}

    this.visible = true;
  }

  hide() {
    if (!this.view) return;
    try {
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

  loadURL(url: string, forceReload = false) {
    // Don't load empty or invalid URLs
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return;
    }

    const v = this.ensureView();
    if (!v) return;
    try {
      // Normalize URL for comparison
      const normalizeUrl = (u: string) => u.replace(/\/$/, '').toLowerCase();
      const current = (() => {
        try {
          return v.webContents.getURL();
        } catch {
          return '';
        }
      })();
      // Load if URL is different or if forceReload is true
      if (forceReload || !current || normalizeUrl(current) !== normalizeUrl(url)) {
        // Ensure view is visible before loading
        const win = getMainWindow();
        if (win && this.visible) {
          this.bringToFront(win);
        }
        v.webContents.loadURL(url);
        // Focus after loading to ensure it's active
        setTimeout(() => {
          try {
            v.webContents.focus();
          } catch {}
        }, 50);
      }
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

  openDevTools() {
    try {
      this.view?.webContents.openDevTools({ mode: 'detach' });
    } catch {}
  }

  isVisible(): boolean {
    return this.visible;
  }
}

export const browserViewService = new BrowserViewService();
