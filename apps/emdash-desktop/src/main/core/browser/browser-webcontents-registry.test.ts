import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWebContentsRegistry } from './browser-webcontents-registry';

const mocks = vi.hoisted(() => ({
  sessionsByPartition: new Map<string, object>(),
  writeImage: vi.fn(),
}));

vi.mock('electron', () => ({
  clipboard: {
    writeImage: mocks.writeImage,
  },
  session: {
    fromPartition: (partition: string) => {
      let value = mocks.sessionsByPartition.get(partition);
      if (!value) {
        value = { partition };
        mocks.sessionsByPartition.set(partition, value);
      }
      return value;
    },
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

function webContentsWithSession(session: object): WebContents {
  return {
    session,
  } as WebContents;
}

function attachedWebContents(session: object, image: { isEmpty: () => boolean }): WebContents {
  return {
    id: 1,
    session,
    capturePage: vi.fn().mockResolvedValue(image),
    isDestroyed: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    once: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  } as unknown as WebContents;
}

describe('BrowserWebContentsRegistry', () => {
  beforeEach(() => {
    mocks.sessionsByPartition.clear();
    mocks.writeImage.mockClear();
  });

  it('resolves the browser id from the attached webContents session', () => {
    const registry = new BrowserWebContentsRegistry();
    const firstPartition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const secondPartition = 'persist:emdash-browser-project-workspace-task-browser-2';
    const firstSession = { partition: firstPartition };
    const secondSession = { partition: secondPartition };
    mocks.sessionsByPartition.set(firstPartition, firstSession);
    mocks.sessionsByPartition.set(secondPartition, secondSession);

    registry.registerSession({
      browserId: 'browser-1',
      partition: firstPartition,
    });
    registry.registerSession({
      browserId: 'browser-2',
      partition: secondPartition,
    });

    expect(registry.getBrowserIdForWebContents(webContentsWithSession(secondSession))).toBe(
      'browser-2'
    );
  });

  it('does not resolve unregistered webContents sessions', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({
      browserId: 'browser-1',
      partition: 'persist:emdash-browser-project-workspace-task-browser-1',
    });

    expect(registry.getBrowserIdForWebContents(webContentsWithSession({}))).toBeUndefined();
  });

  it('clears browser data only for registered sessions', async () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const clearStorageData = vi.fn().mockResolvedValue(undefined);
    const clearCache = vi.fn().mockResolvedValue(undefined);
    mocks.sessionsByPartition.set(partition, { partition, clearStorageData, clearCache });

    registry.registerSession({ browserId: 'browser-1', partition });

    expect(await registry.clearData('browser-1', 'storage')).toBe(true);
    expect(clearStorageData).toHaveBeenCalledWith();

    expect(await registry.clearData('browser-1', 'cookies')).toBe(true);
    expect(clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });

    expect(await registry.clearData('browser-1', 'cache')).toBe(true);
    expect(clearCache).toHaveBeenCalledWith();

    expect(await registry.clearData('missing', 'storage')).toBe(false);
    expect(await registry.clearData('missing', 'cookies')).toBe(false);
    expect(await registry.clearData('missing', 'cache')).toBe(false);
  });

  it('captures screenshots from attached webContents to the clipboard', async () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const partitionSession = { partition };
    const image = { isEmpty: vi.fn().mockReturnValue(false) };
    mocks.sessionsByPartition.set(partition, partitionSession);

    registry.registerSession({ browserId: 'browser-1', partition });
    registry.attachWebContents('browser-1', attachedWebContents(partitionSession, image));

    expect(await registry.captureScreenshotToClipboard('browser-1')).toBe(true);
    expect(mocks.writeImage).toHaveBeenCalledWith(image);
  });
});
