import { app } from 'electron';
// Ensure PATH matches the user's shell when launched from Finder (macOS)
// so Homebrew/NPM global binaries like `gh` and `codex` are found.
try {
  // Lazy import to avoid bundler complaints if not present on other platforms
  // We also defensively prepend common Homebrew locations.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fixPath = require('fix-path');
  if (typeof fixPath === 'function') fixPath();
} catch {
  // no-op if fix-path isn't available at runtime
}

if (process.platform === 'darwin') {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin', '/usr/local/sbin'];
  const cur = process.env.PATH || '';
  const parts = cur.split(':').filter(Boolean);
  for (const p of extras) {
    if (!parts.includes(p)) parts.unshift(p);
  }
  process.env.PATH = parts.join(':');

  // As a last resort, ask the user's login shell for PATH and merge it in.
  try {
    const { execSync } = require('child_process');
    const shell = process.env.SHELL || '/bin/zsh';
    const loginPath = execSync(`${shell} -ilc 'echo -n $PATH'`, { encoding: 'utf8' });
    if (loginPath) {
      const merged = new Set((loginPath + ':' + process.env.PATH).split(':').filter(Boolean));
      process.env.PATH = Array.from(merged).join(':');
    }
  } catch {}
}
import { createMainWindow } from './app/window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerAllIpc } from './ipc';
import * as telemetry from './telemetry';

// App bootstrap
app.whenReady().then(async () => {
  // Initialize telemetry (privacy-first, anonymous)
  telemetry.init({ installSource: app.isPackaged ? 'dmg' : 'dev' });

  // Register IPC handlers
  registerAllIpc();

  // Create main window
  createMainWindow();
});

// App lifecycle handlers
registerAppLifecycle();

// Graceful shutdown telemetry event
app.on('before-quit', () => {
  // Session summary with duration (no identifiers)
  telemetry.capture('app_session');
  telemetry.capture('app_closed');
  telemetry.shutdown();
});
