import { createController, type Controller } from '@emdash/wire/api';
import type { BrowserDataClearKind, BrowsingDataKind } from '@core/primitives/browser/api';
import { browserContract } from '../api';
import { browserEvents } from './event-host';

export type BrowserOperations = {
  registerSession(input: { browserId: string; partition: string }): BrowserActionResult;
  unregisterSession(browserId: string): BrowserActionResult;
  bindWebContents(input: { browserId: string; webContentsId: number }): BrowserActionResult;
  setActiveBrowser(browserId: string | null): BrowserActionResult;
  getActiveBrowser(): { browserId: string | null };
  openDevTools(browserId: string): BrowserActionResult;
  captureScreenshot(browserId: string): Promise<BrowserActionResult>;
  clearData(browserId: string, kind: BrowserDataClearKind): Promise<BrowserActionResult>;
  clearProfileStorage(profileId: string): Promise<BrowserActionResult>;
  clearBrowsingData(kind: BrowsingDataKind): Promise<BrowserActionResult>;
};

type BrowserActionResult = { success: boolean; error?: string };

export function createBrowserWireController(browserOperations: BrowserOperations): Controller {
  return createController(browserContract, {
    registerSession: (input) => browserOperations.registerSession(input),
    unregisterSession: ({ browserId }) => browserOperations.unregisterSession(browserId),
    bindWebContents: (input) => browserOperations.bindWebContents(input),
    setActiveBrowser: ({ browserId }) => browserOperations.setActiveBrowser(browserId),
    getActiveBrowser: () => browserOperations.getActiveBrowser(),
    openDevTools: ({ browserId }) => browserOperations.openDevTools(browserId),
    captureScreenshot: ({ browserId }) => browserOperations.captureScreenshot(browserId),
    clearData: ({ browserId, kind }) => browserOperations.clearData(browserId, kind),
    clearProfileStorage: ({ profileId }) => browserOperations.clearProfileStorage(profileId),
    clearBrowsingData: ({ kind }) => browserOperations.clearBrowsingData(kind),
    events: browserEvents,
  });
}
