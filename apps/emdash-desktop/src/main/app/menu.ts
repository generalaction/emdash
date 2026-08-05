import { app, clipboard, Menu, shell } from 'electron';
import { events } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
import {
  type AppMenuId,
  menuCheckForUpdatesChannel,
  menuCloseTabChannel,
  menuGiveFeedbackChannel,
  menuOpenSettingsChannel,
  menuQuitRequestedChannel,
  menuRedoChannel,
  menuUndoChannel,
} from '@shared/events/appEvents';
import { EMDASH_DOCS_URL, EMDASH_ISSUES_NEW_URL, EMDASH_RELEASES_URL } from '@shared/urls';
import { getMainWindow } from './window';

function copyInstallationId(): void {
  const instanceId = telemetryService.getInstanceId() ?? 'unavailable';
  const lines = [
    `Emdash ${app.getVersion()}`,
    `Installation ID: ${instanceId}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Electron: ${process.versions.electron}`,
  ];
  clipboard.writeText(lines.join('\n'));
}

function requestQuit(): void {
  const win = getMainWindow();
  if (!win || win.webContents.isLoading()) {
    app.quit();
    return;
  }

  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  events.emit(menuQuitRequestedChannel, undefined);
}

function buildFileSubmenu(isMac: boolean): Electron.MenuItemConstructorOptions[] {
  return [
    // On non-macOS, put Settings in the File menu (macOS keeps it in the app menu).
    ...(!isMac
      ? [
          {
            label: 'Settings…',
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
      : {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: requestQuit,
        },
  ];
}

function buildEditSubmenu(isMac: boolean): Electron.MenuItemConstructorOptions[] {
  return [
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
  ];
}

function buildViewSubmenu(): Electron.MenuItemConstructorOptions[] {
  return [
    { role: 'reload' as const },
    { role: 'forceReload' as const },
    { role: 'toggleDevTools' as const },
    { type: 'separator' as const },
    { role: 'resetZoom' as const },
    { role: 'zoomIn' as const },
    { role: 'zoomOut' as const },
    { type: 'separator' as const },
    { role: 'togglefullscreen' as const },
  ];
}

function buildHelpSubmenu(isMac: boolean): Electron.MenuItemConstructorOptions[] {
  return [
    ...(!isMac
      ? [
          {
            label: 'Check for Updates…',
            click: () => events.emit(menuCheckForUpdatesChannel, undefined),
          },
          { type: 'separator' as const },
        ]
      : []),
    {
      label: 'Docs',
      click: () => {
        void shell.openExternal(EMDASH_DOCS_URL);
      },
    },
    {
      label: 'Changelog',
      click: () => {
        void shell.openExternal(EMDASH_RELEASES_URL);
      },
    },
    { type: 'separator' as const },
    {
      label: 'Troubleshooting',
      submenu: [
        {
          label: 'Report Issue…',
          click: () => {
            void shell.openExternal(EMDASH_ISSUES_NEW_URL);
          },
        },
        {
          label: 'Copy Installation ID',
          click: copyInstallationId,
        },
      ],
    },
    {
      label: 'Give Feedback',
      click: () => events.emit(menuGiveFeedbackChannel, undefined),
    },
  ];
}

function buildAppMenuSubmenu(
  menu: AppMenuId,
  isMac: boolean
): Electron.MenuItemConstructorOptions[] {
  switch (menu) {
    case 'file':
      return buildFileSubmenu(isMac);
    case 'edit':
      return buildEditSubmenu(isMac);
    case 'view':
      return buildViewSubmenu();
    case 'help':
      return buildHelpSubmenu(isMac);
  }
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
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              {
                label: 'Check for Updates…',
                click: () => events.emit(menuCheckForUpdatesChannel, undefined),
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
                click: requestQuit,
              },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    { label: 'File', submenu: buildFileSubmenu(isMac) },
    { label: 'Edit', submenu: buildEditSubmenu(isMac) },
    { label: 'View', submenu: buildViewSubmenu() },
    // Window menu
    { role: 'windowMenu' as const },
    { role: 'help' as const, label: 'Help', submenu: buildHelpSubmenu(isMac) },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Pops up a single top-level menu's submenu as a native context menu, anchored
 * at the given window-relative coordinates. Drives the custom in-window menu bar
 * on Windows/Linux (see WindowMenuBar), reusing the same submenu definitions as
 * the application menu so there is a single source of truth.
 */
export function popupAppMenu(menu: AppMenuId, x: number, y: number): void {
  const isMac = process.platform === 'darwin';
  const win = getMainWindow() ?? undefined;
  Menu.buildFromTemplate(buildAppMenuSubmenu(menu, isMac)).popup({
    window: win,
    x: Math.round(x),
    y: Math.round(y),
  });
}
