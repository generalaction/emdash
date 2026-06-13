import { app, Menu } from 'electron';
import { performCompactMenuAction } from '@main/app/menu-action-context';
import { events } from '@main/lib/events';
import { menuCloseTabChannel } from '@shared/events/appEvents';

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
                click: () => void performCompactMenuAction('settings'),
              },
              {
                label: 'Check for Updates\u2026',
                click: () => void performCompactMenuAction('check-for-updates'),
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
                click: () => void performCompactMenuAction('quit'),
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
                click: () => void performCompactMenuAction('settings'),
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
              click: () => void performCompactMenuAction('quit'),
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
          click: () => void performCompactMenuAction('undo'),
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
          click: () => void performCompactMenuAction('redo'),
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
                click: () => void performCompactMenuAction('check-for-updates'),
              },
              { type: 'separator' as const },
            ]
          : []),
        {
          label: 'Docs',
          click: () => void performCompactMenuAction('docs'),
        },
        {
          label: 'Changelog',
          click: () => void performCompactMenuAction('changelog'),
        },
        { type: 'separator' as const },
        {
          label: 'Troubleshooting',
          submenu: [
            {
              label: 'Report Issue\u2026',
              click: () => void performCompactMenuAction('report-issue'),
            },
            {
              label: 'Copy Installation ID',
              click: () => void performCompactMenuAction('copy-installation-id'),
            },
          ],
        },
        {
          label: 'Give Feedback',
          click: () => void performCompactMenuAction('give-feedback'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
