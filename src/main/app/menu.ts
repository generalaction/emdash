import { Menu, shell, app, BrowserWindow, ipcMain } from 'electron';
import { EMDASH_RELEASES_URL, EMDASH_DOCS_URL } from '@shared/urls';

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function sendToRenderer(channel: string) {
  const win = getFocusedWindow();
  if (win) win.webContents.send(channel);
}

/** Menu labels exposed to the renderer for the custom title-bar menu. */
export type TitlebarMenuLabel = 'File' | 'Edit' | 'View' | 'Window' | 'Help';

function getWindowsMenuTemplate(): Record<
  TitlebarMenuLabel,
  Electron.MenuItemConstructorOptions[]
> {
  return {
    File: [
      {
        label: 'Settings\u2026',
        accelerator: 'CmdOrCtrl+,',
        click: () => sendToRenderer('menu:open-settings'),
      },
      { type: 'separator' },
      {
        label: 'Close Tab',
        accelerator: 'CmdOrCtrl+W',
        click: () => sendToRenderer('menu:close-tab'),
      },
      { type: 'separator' },
      { role: 'quit' },
    ],
    Edit: [
      {
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        click: () => sendToRenderer('menu:undo'),
      },
      {
        label: 'Redo',
        accelerator: 'CmdOrCtrl+Y',
        click: () => sendToRenderer('menu:redo'),
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
    View: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
    Window: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    Help: [
      {
        label: 'Docs',
        click: () => shell.openExternal(EMDASH_DOCS_URL),
      },
      {
        label: 'Changelog',
        click: () => shell.openExternal(EMDASH_RELEASES_URL),
      },
      { type: 'separator' },
      {
        label: 'Check for Updates\u2026',
        click: () => sendToRenderer('menu:check-for-updates'),
      },
    ],
  };
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
                click: () => sendToRenderer('menu:open-settings'),
              },
              {
                label: 'Check for Updates\u2026',
                click: () => sendToRenderer('menu:check-for-updates'),
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
                click: () => sendToRenderer('menu:open-settings'),
              },
              { type: 'separator' as const },
            ]
          : []),
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendToRenderer('menu:close-tab'),
        },
        ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const }] : []),
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendToRenderer('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
          click: () => sendToRenderer('menu:redo'),
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
                click: () => sendToRenderer('menu:check-for-updates'),
              },
            ]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Register IPC handler for popup menus (custom title bar on Windows/Linux)
  if (!isMac) {
    const windowsMenus = getWindowsMenuTemplate();

    ipcMain.handle('app:popupMenu', (_event, args: { label: string; x: number; y: number }) => {
      const win = getFocusedWindow();
      if (!win) return;
      const items = windowsMenus[args.label as TitlebarMenuLabel];
      if (!items) return;
      const contextMenu = Menu.buildFromTemplate(items);
      contextMenu.popup({ window: win, x: Math.round(args.x), y: Math.round(args.y) });
    });
  }
}
