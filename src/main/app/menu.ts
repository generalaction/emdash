import { app, Menu, shell } from 'electron';
import {
  menuCloseTabChannel,
  menuOpenSettingsChannel,
  menuRedoChannel,
  menuUndoChannel,
} from '@shared/events/appEvents';
import { EMDASH_DOCS_URL, EMDASH_RELEASES_URL } from '@shared/urls';
import { updateService } from '@main/core/updates/update-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

function triggerUserInitiatedUpdateCheck(): void {
  updateService.checkForUpdatesUserInitiated().catch((error) => {
    log.error('User-initiated update check failed:', error);
  });
}

export function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: `About ${app.name}`,
                click: () => app.showAboutPanel(),
              },
              { type: 'separator' as const },
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              {
                label: 'Check for Updates\u2026',
                click: triggerUserInitiatedUpdateCheck,
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              {
                label: `Quit ${app.name}`,
                accelerator: 'CmdOrCtrl+Q',
                click: () => app.quit(),
              },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    // File menu
    {
      label: 'File',
      submenu: [
        // On non-macOS, put Settings in File menu
        ...(!isMac
          ? [
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              { type: 'separator' as const },
            ]
          : []),
        isMac
          ? {
              label: 'Close Tab',
              accelerator: 'CmdOrCtrl+W',
              click: () => events.emit(menuCloseTabChannel, undefined),
            }
          : { role: 'quit' as const },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => events.emit(menuUndoChannel, undefined),
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
          click: () => events.emit(menuRedoChannel, undefined),
        },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    // Window menu
    { role: 'windowMenu' as const },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Docs',
          click: () => shell.openExternal(EMDASH_DOCS_URL),
        },
        {
          label: 'Changelog',
          click: () => shell.openExternal(EMDASH_RELEASES_URL),
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Check for Updates\u2026',
                click: triggerUserInitiatedUpdateCheck,
              },
            ]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
