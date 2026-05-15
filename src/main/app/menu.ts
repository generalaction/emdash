import { app, clipboard, Menu, shell } from 'electron';
import {
  menuCheckForUpdatesChannel,
  menuCloseTabChannel,
  menuGiveFeedbackChannel,
  menuOpenSettingsChannel,
  menuQuitRequestedChannel,
  menuRedoChannel,
  menuUndoChannel,
} from '@shared/events/appEvents';
import { EMDASH_DOCS_URL, EMDASH_ISSUES_NEW_URL, EMDASH_RELEASES_URL } from '@shared/urls';
import { events } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
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
          : {
              label: 'Quit',
              accelerator: 'CmdOrCtrl+Q',
              click: requestQuit,
            },
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
      role: 'help' as const,
      label: 'Help',
      submenu: [
        ...(!isMac
          ? [
              {
                label: 'Check for Updates\u2026',
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
              label: 'Report Issue\u2026',
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
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
