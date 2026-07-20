import { join } from 'node:path';
import { app } from 'electron';
import { setupApplicationMenu } from '@main/host/menu';
import { setupAppProtocol } from '@main/host/protocol';
import { initializeTray } from '@main/host/tray';
import { createMainWindow } from '@main/host/window';
import type { Phase } from '../../core/phase';
import { registerQuitHandler } from '../../shutdown';
import type { BootContext } from '../types';

export const windowPhase: Phase<BootContext> = {
  name: 'window',
  run(context) {
    setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
    setupApplicationMenu();
    createMainWindow();
    initializeTray();
    registerQuitHandler();
    context.windowPhaseReady = true;
  },
};
