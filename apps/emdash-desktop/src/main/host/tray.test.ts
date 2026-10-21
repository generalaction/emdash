import type * as fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { instances, quit, showMainWindow } = vi.hoisted(() => ({
  instances: [] as Array<{ destroyed: boolean; destroy: () => void }>,
  quit: vi.fn(),
  showMainWindow: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  readFileSync: vi.fn(() => Buffer.from('icon')),
}));

vi.mock('electron', () => ({
  app: { quit },
  Menu: { buildFromTemplate: vi.fn((items) => items) },
  nativeImage: {
    createEmpty: () => ({ addRepresentation: vi.fn(), setTemplateImage: vi.fn() }),
    createFromPath: () => ({ resize: vi.fn() }),
  },
  Tray: class {
    destroyed = false;
    constructor() {
      instances.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
  },
}));

vi.mock('./window', () => ({ showMainWindow }));

import { setTrayVisible } from './tray';

afterEach(() => {
  setTrayVisible(false);
  instances.length = 0;
  vi.clearAllMocks();
});

describe('tray visibility', () => {
  it('does not create an icon when starting with the preference disabled', () => {
    setTrayVisible(false);
    expect(instances).toHaveLength(0);
  });

  it('removes and restores the icon without duplicates or quitting the app', () => {
    setTrayVisible(true);
    setTrayVisible(true);
    expect(instances).toHaveLength(1);

    setTrayVisible(false);
    setTrayVisible(false);
    expect(instances[0].destroyed).toBe(true);

    setTrayVisible(true);
    setTrayVisible(true);
    expect(instances).toHaveLength(2);
    expect(instances[1].destroyed).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    expect(showMainWindow).not.toHaveBeenCalled();
  });
});
