import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWebContentsRegistry } from './browser-webcontents-registry';

const sessionsByPartition = new Map<string, object>();

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => {
      let value = sessionsByPartition.get(partition);
      if (!value) {
        value = { partition };
        sessionsByPartition.set(partition, value);
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

describe('BrowserWebContentsRegistry', () => {
  beforeEach(() => {
    sessionsByPartition.clear();
  });

  it('resolves the browser id from the attached webContents session', () => {
    const registry = new BrowserWebContentsRegistry();
    const firstPartition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const secondPartition = 'persist:emdash-browser-project-workspace-task-browser-2';
    const firstSession = { partition: firstPartition };
    const secondSession = { partition: secondPartition };
    sessionsByPartition.set(firstPartition, firstSession);
    sessionsByPartition.set(secondPartition, secondSession);

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
});
