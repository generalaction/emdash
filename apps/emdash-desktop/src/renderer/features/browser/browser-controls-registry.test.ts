import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserControlsRegistry, type BrowserControls } from './browser-controls-registry';

function controls(reload: () => void): BrowserControls {
  return {
    adapter: null,
    focusUrl: vi.fn(),
    reload,
  };
}

describe('browserControlsRegistry reload', () => {
  beforeEach(() => {
    browserControlsRegistry.clear();
  });

  it('runs a reload queued before controls registration', () => {
    const reload = vi.fn();

    browserControlsRegistry.reload('browser-1');
    browserControlsRegistry.register('browser-1', controls(reload));

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads registered browser controls immediately', () => {
    const reload = vi.fn();
    browserControlsRegistry.register('browser-1', controls(reload));

    browserControlsRegistry.reload('browser-1');

    expect(reload).toHaveBeenCalledOnce();
  });

  it('discards a queued reload when the browser is removed', () => {
    const reload = vi.fn();
    browserControlsRegistry.reload('browser-1');

    browserControlsRegistry.remove('browser-1');
    browserControlsRegistry.register('browser-1', controls(reload));

    expect(reload).not.toHaveBeenCalled();
  });
});
