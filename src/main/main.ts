import { app, nativeImage } from 'electron'
// Ensure PATH matches the user's shell when launched from Finder (macOS)
// so Homebrew/NPM global binaries like `gh` and `codex` are found.
try {
  // Lazy import to avoid bundler complaints if not present on other platforms
  // We also defensively prepend common Homebrew locations.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fixPath = require('fix-path');
  if (typeof fixPath === 'function') fixPath();
} catch (error) {
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
  } catch (error) {}
}
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { createMainWindow } from './app/window'
import { registerAppLifecycle } from './app/lifecycle'
import { registerAllIpc } from './ipc'
import { databaseService } from './services/DatabaseService'

// App bootstrap
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'emdash.icns')
      : join(__dirname, '..', '..', 'src', 'assets', 'images', 'emdash', 'emdash.icns')

    let dockIcon: Electron.NativeImage | undefined

    if (existsSync(iconPath)) {
      dockIcon = nativeImage.createFromPath(iconPath)

      if (dockIcon.isEmpty()) {
        try {
          dockIcon = nativeImage.createFromBuffer(readFileSync(iconPath))
        } catch {
          dockIcon = undefined
        }
      }
    }

    if (!dockIcon || dockIcon.isEmpty()) {
      const fallbackIconPath = join(
        __dirname,
        '..',
        '..',
        'src',
        'assets',
        'images',
        'emdash',
        'emdash_dev.png',
      )
      if (existsSync(fallbackIconPath)) {
        const fallbackIcon = nativeImage.createFromPath(fallbackIconPath)
        if (!fallbackIcon.isEmpty()) {
          dockIcon = fallbackIcon
        }
      }
    }

    if (dockIcon && !dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }

  // Initialize database
  try {
    await databaseService.initialize()
    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Failed to initialize database:', error)
  }

  // Register IPC handlers
  registerAllIpc()

  // Create main window
  createMainWindow()
})

// App lifecycle handlers
registerAppLifecycle()
