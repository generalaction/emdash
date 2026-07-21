import { join } from 'node:path';
import { app } from 'electron';
import { setupApplicationMenu } from '@main/host/menu';
import { setupAppProtocol } from '@main/host/protocol';
import { initializeTray } from '@main/host/tray';
import { createMainWindow } from '@main/host/window';
import { registerQuitHandler } from '../../shutdown';
import type { BootSignals } from '../types';

export function bootWindow(signals: BootSignals): void {
  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();
  initializeTray();
  registerQuitHandler();
  signals.windowPhaseReady = true;
}
