import { createController, type Controller } from '@emdash/wire/api';
import { browserOperations } from '@main/host/browser/controller';
import { browserContract } from '../api';
import { browserEvents } from './event-host';

export function createBrowserWireController(): Controller {
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
