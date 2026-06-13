import type { CompactMenuActionId } from '@shared/app-menu';
import {
  menuCheckForUpdatesChannel,
  menuGiveFeedbackChannel,
  menuOpenSettingsChannel,
  menuQuitRequestedChannel,
} from '@shared/events/appEvents';
import { EMDASH_DOCS_URL, EMDASH_ISSUES_NEW_URL, EMDASH_RELEASES_URL } from '@shared/urls';

type VoidEvent = { name: string };

export type CompactMenuWebContents = {
  undo?: () => void;
  redo?: () => void;
  cut?: () => void;
  copy?: () => void;
  paste?: () => void;
  delete?: () => void;
  selectAll?: () => void;
  reload?: () => void;
  reloadIgnoringCache?: () => void;
  toggleDevTools?: () => void;
  getZoomLevel?: () => number;
  setZoomLevel?: (level: number) => void;
  isLoading?: () => boolean;
};

export type CompactMenuWindow = {
  webContents: CompactMenuWebContents;
  isFullScreen?: () => boolean;
  setFullScreen?: (fullScreen: boolean) => void;
  minimize?: () => void;
  close?: () => void;
  isMinimized?: () => boolean;
  restore?: () => void;
  show?: () => void;
  focus?: () => void;
};

export type CompactMenuActionContext = {
  getWindow: () => CompactMenuWindow | null;
  emit: (event: VoidEvent, data: undefined) => void;
  openExternal: (url: string) => Promise<void> | void;
  copyInstallationId: () => void;
  quitImmediately?: () => void;
};

export async function executeCompactMenuAction(
  actionId: CompactMenuActionId,
  context: CompactMenuActionContext
): Promise<void> {
  const win = context.getWindow();
  const webContents = win?.webContents;

  switch (actionId) {
    case 'settings':
      context.emit(menuOpenSettingsChannel, undefined);
      return;
    case 'check-for-updates':
      context.emit(menuCheckForUpdatesChannel, undefined);
      return;
    case 'quit':
      requestQuit(context, win);
      return;
    case 'undo':
      webContents?.undo?.();
      return;
    case 'redo':
      webContents?.redo?.();
      return;
    case 'cut':
      webContents?.cut?.();
      return;
    case 'copy':
      webContents?.copy?.();
      return;
    case 'paste':
      webContents?.paste?.();
      return;
    case 'delete':
      webContents?.delete?.();
      return;
    case 'select-all':
      webContents?.selectAll?.();
      return;
    case 'reload':
      webContents?.reload?.();
      return;
    case 'force-reload':
      webContents?.reloadIgnoringCache?.();
      return;
    case 'toggle-devtools':
      webContents?.toggleDevTools?.();
      return;
    case 'reset-zoom':
      webContents?.setZoomLevel?.(0);
      return;
    case 'zoom-in':
      webContents?.setZoomLevel?.((webContents.getZoomLevel?.() ?? 0) + 0.5);
      return;
    case 'zoom-out':
      webContents?.setZoomLevel?.((webContents.getZoomLevel?.() ?? 0) - 0.5);
      return;
    case 'toggle-fullscreen':
      win?.setFullScreen?.(!(win.isFullScreen?.() ?? false));
      return;
    case 'minimize-window':
      win?.minimize?.();
      return;
    case 'close-window':
      win?.close?.();
      return;
    case 'docs':
      await context.openExternal(EMDASH_DOCS_URL);
      return;
    case 'changelog':
      await context.openExternal(EMDASH_RELEASES_URL);
      return;
    case 'report-issue':
      await context.openExternal(EMDASH_ISSUES_NEW_URL);
      return;
    case 'copy-installation-id':
      context.copyInstallationId();
      return;
    case 'give-feedback':
      context.emit(menuGiveFeedbackChannel, undefined);
      return;
  }
}

function requestQuit(
  context: CompactMenuActionContext,
  win: CompactMenuWindow | null | undefined
): void {
  if (!win || win.webContents.isLoading?.()) {
    context.quitImmediately?.();
    return;
  }

  if (win.isMinimized?.()) win.restore?.();
  win.show?.();
  win.focus?.();
  context.emit(menuQuitRequestedChannel, undefined);
}
