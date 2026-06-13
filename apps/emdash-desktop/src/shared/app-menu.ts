export const COMPACT_MENU_ACTION_IDS = [
  'settings',
  'check-for-updates',
  'quit',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'delete',
  'select-all',
  'reload',
  'force-reload',
  'toggle-devtools',
  'reset-zoom',
  'zoom-in',
  'zoom-out',
  'toggle-fullscreen',
  'minimize-window',
  'close-window',
  'docs',
  'changelog',
  'report-issue',
  'copy-installation-id',
  'give-feedback',
] as const;

export type CompactMenuActionId = (typeof COMPACT_MENU_ACTION_IDS)[number];

export type CompactMenuActionItem = {
  type: 'action';
  id: CompactMenuActionId;
  label: string;
  shortcut?: string;
};

export type CompactMenuSeparatorItem = {
  type: 'separator';
};

export type CompactMenuSubmenuItem = {
  type: 'submenu';
  label: string;
  items: readonly CompactMenuItem[];
};

export type CompactMenuItem =
  | CompactMenuActionItem
  | CompactMenuSeparatorItem
  | CompactMenuSubmenuItem;

export type CompactMenuGroup = {
  label: string;
  items: readonly CompactMenuItem[];
};

const separator = { type: 'separator' } as const;

export const COMPACT_APP_MENU: readonly CompactMenuGroup[] = [
  {
    label: 'File',
    items: [
      { type: 'action', id: 'settings', label: 'Settings...', shortcut: 'Ctrl+,' },
      separator,
      { type: 'action', id: 'quit', label: 'Quit', shortcut: 'Ctrl+Q' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { type: 'action', id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { type: 'action', id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
      separator,
      { type: 'action', id: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
      { type: 'action', id: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
      { type: 'action', id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
      { type: 'action', id: 'delete', label: 'Delete' },
      separator,
      { type: 'action', id: 'select-all', label: 'Select All', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: 'View',
    items: [
      { type: 'action', id: 'reload', label: 'Reload', shortcut: 'Ctrl+R' },
      { type: 'action', id: 'force-reload', label: 'Force Reload', shortcut: 'Ctrl+Shift+R' },
      {
        type: 'action',
        id: 'toggle-devtools',
        label: 'Toggle Developer Tools',
        shortcut: 'Ctrl+Shift+I',
      },
      separator,
      { type: 'action', id: 'reset-zoom', label: 'Actual Size', shortcut: 'Ctrl+0' },
      { type: 'action', id: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl+=' },
      { type: 'action', id: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+-' },
      separator,
      { type: 'action', id: 'toggle-fullscreen', label: 'Toggle Full Screen', shortcut: 'F11' },
    ],
  },
  {
    label: 'Window',
    items: [
      { type: 'action', id: 'minimize-window', label: 'Minimize' },
      { type: 'action', id: 'close-window', label: 'Close' },
    ],
  },
  {
    label: 'Help',
    items: [
      { type: 'action', id: 'check-for-updates', label: 'Check for Updates...' },
      separator,
      { type: 'action', id: 'docs', label: 'Docs' },
      { type: 'action', id: 'changelog', label: 'Changelog' },
      separator,
      {
        type: 'submenu',
        label: 'Troubleshooting',
        items: [
          { type: 'action', id: 'report-issue', label: 'Report Issue...' },
          { type: 'action', id: 'copy-installation-id', label: 'Copy Installation ID' },
        ],
      },
      { type: 'action', id: 'give-feedback', label: 'Give Feedback' },
    ],
  },
];

export function listCompactMenuActionIds(
  groups: readonly CompactMenuGroup[] = COMPACT_APP_MENU
): CompactMenuActionId[] {
  return groups.flatMap((group) => listActionIdsFromItems(group.items));
}

function listActionIdsFromItems(items: readonly CompactMenuItem[]): CompactMenuActionId[] {
  return items.flatMap((item) => {
    if (item.type === 'action') return [item.id];
    if (item.type === 'submenu') return listActionIdsFromItems(item.items);
    return [];
  });
}
