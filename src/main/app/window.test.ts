import type { BrowserWindowConstructorOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

const capture = vi.fn();
const checkAndReportDailyActiveUser = vi.fn();
const registerExternalLinkHandlers = vi.fn();

class MockBrowserWindow {
  static instances: MockBrowserWindow[] = [];

  readonly options: BrowserWindowConstructorOptions;
  readonly eventHandlers = new Map<string, () => void>();
  readonly loadURL = vi.fn();
  readonly show = vi.fn();
  readonly on = vi.fn((event: string, handler: () => void) => {
    this.eventHandlers.set(event, handler);
    return this;
  });
  readonly once = vi.fn((event: string, handler: () => void) => {
    this.eventHandlers.set(event, handler);
    return this;
  });
  readonly setWindowButtonVisibility = vi.fn();

  constructor(options: BrowserWindowConstructorOptions) {
    this.options = options;
    MockBrowserWindow.instances.push(this);
  }

  emit(event: string): void {
    this.eventHandlers.get(event)?.();
  }
}

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
}));

vi.mock('@/assets/images/emdash/emdash_logo.png?asset', () => ({
  default: 'app-icon.png',
}));

vi.mock('@shared/app-identity', () => ({
  PRODUCT_NAME: 'Emdash',
}));

vi.mock('@main/lib/telemetry', () => ({
  capture: (...args: unknown[]) => capture(...args),
  checkAndReportDailyActiveUser: (...args: unknown[]) => checkAndReportDailyActiveUser(...args),
}));

vi.mock('@main/utils/externalLinks', () => ({
  registerExternalLinkHandlers: (...args: unknown[]) => registerExternalLinkHandlers(...args),
}));

vi.mock('./protocol', () => ({
  APP_ORIGIN: 'app://emdash.test',
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

async function importWindowModule(platform: NodeJS.Platform) {
  vi.resetModules();
  setPlatform(platform);
  return import('./window');
}

afterEach(() => {
  MockBrowserWindow.instances = [];
  vi.clearAllMocks();

  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

describe('createMainWindow', () => {
  it('does not call the macOS-only window button API on Windows focus', async () => {
    const { createMainWindow } = await importWindowModule('win32');

    createMainWindow();

    const window = MockBrowserWindow.instances[0];
    window.emit('focus');

    expect(registerExternalLinkHandlers).toHaveBeenCalledOnce();
    expect(registerExternalLinkHandlers.mock.calls[0]?.[0]).toBe(window);
    expect(capture).toHaveBeenCalledWith('app_window_focused');
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(checkAndReportDailyActiveUser).toHaveBeenCalled();
  });

  it('restores the macOS window buttons when the window regains focus', async () => {
    const { createMainWindow } = await importWindowModule('darwin');

    createMainWindow();

    const window = MockBrowserWindow.instances[0];
    window.emit('focus');

    expect(window.options.titleBarStyle).toBe('hiddenInset');
    expect(window.options.trafficLightPosition).toEqual({ x: 10, y: 10 });
    expect(window.setWindowButtonVisibility).toHaveBeenCalledWith(true);
  });
});
