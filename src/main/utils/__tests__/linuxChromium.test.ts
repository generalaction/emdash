import { describe, expect, it, vi } from 'vitest';
import { configureLinuxChromium } from '../linuxChromium';

describe('configureLinuxChromium', () => {
  it('does nothing outside Linux', () => {
    const appendSwitch = vi.fn();

    configureLinuxChromium({ appendSwitch }, {}, 'darwin');

    expect(appendSwitch).not.toHaveBeenCalled();
  });

  it('always enables automatic ozone platform detection on Linux', () => {
    const appendSwitch = vi.fn();

    configureLinuxChromium({ appendSwitch }, {}, 'linux');

    expect(appendSwitch).toHaveBeenCalledTimes(1);
    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform-hint', 'auto');
  });

  it('enables Wayland IME when a Wayland session is detected', () => {
    const appendSwitch = vi.fn();

    configureLinuxChromium(
      {
        appendSwitch,
      },
      {
        WAYLAND_DISPLAY: 'wayland-1',
        XDG_SESSION_TYPE: 'wayland',
      },
      'linux'
    );

    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'ozone-platform-hint', 'auto');
    expect(appendSwitch).toHaveBeenNthCalledWith(2, 'enable-wayland-ime');
    expect(appendSwitch).toHaveBeenCalledTimes(2);
  });

  it('treats explicit OZONE_PLATFORM=wayland as a Wayland session', () => {
    const appendSwitch = vi.fn();

    configureLinuxChromium(
      {
        appendSwitch,
      },
      {
        OZONE_PLATFORM: 'wayland',
      },
      'linux'
    );

    expect(appendSwitch).toHaveBeenCalledWith('enable-wayland-ime');
  });

  it('only appends a text-input version when explicitly requested', () => {
    const appendSwitch = vi.fn();

    configureLinuxChromium(
      {
        appendSwitch,
      },
      {
        WAYLAND_DISPLAY: 'wayland-1',
        EMDASH_WAYLAND_TEXT_INPUT_VERSION: '3',
      },
      'linux'
    );

    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'ozone-platform-hint', 'auto');
    expect(appendSwitch).toHaveBeenNthCalledWith(2, 'enable-wayland-ime');
    expect(appendSwitch).toHaveBeenNthCalledWith(3, 'wayland-text-input-version', '3');
  });
});
