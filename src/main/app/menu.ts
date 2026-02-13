import { Menu, shell, app, BrowserWindow } from 'electron';

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function sendToRenderer(channel: string) {
  const win = getFocusedWindow();
  if (win) win.webContents.send(channel);
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
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendToRenderer('menu:open-settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
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
                click: () => sendToRenderer('menu:open-settings'),
              },
              { type: 'separator' as const },
            ]
          : []),
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    // Edit menu
    { role: 'editMenu' as const },
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
          label: 'Emdash Documentation',
          click: () => shell.openExternal('https://docs.emdash.sh'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
