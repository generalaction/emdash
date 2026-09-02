import { describe, expect, it, vi } from 'vitest';
import { configureChromiumCommandLine } from './chromium-command-line';

function createCommandLine(initialSwitches: string[] = []) {
  const switches = new Set(initialSwitches);
  return {
    appendSwitch: vi.fn((name: string) => switches.add(name)),
    hasSwitch: vi.fn((name: string) => switches.has(name)),
  };
}

describe('configureChromiumCommandLine', () => {
  it('configures Linux switches synchronously without requiring a D-Bus environment variable', () => {
    const commandLine = createCommandLine();

    configureChromiumCommandLine({
      commandLine,
      env: { XDG_CURRENT_DESKTOP: 'Hyprland' },
      platform: 'linux',
    });

    expect(commandLine.appendSwitch).toHaveBeenNthCalledWith(1, 'ozone-platform-hint', 'auto');
    expect(commandLine.appendSwitch).toHaveBeenNthCalledWith(
      2,
      'password-store',
      'gnome-libsecret'
    );
  });

  it('preserves an explicit password-store switch', () => {
    const commandLine = createCommandLine(['password-store']);

    configureChromiumCommandLine({
      commandLine,
      env: { XDG_CURRENT_DESKTOP: 'Hyprland' },
      platform: 'linux',
    });

    expect(commandLine.appendSwitch).toHaveBeenCalledOnce();
    expect(commandLine.appendSwitch).toHaveBeenCalledWith('ozone-platform-hint', 'auto');
  });

  it("leaves KDE to Chromium's KWallet selection", () => {
    const commandLine = createCommandLine();

    configureChromiumCommandLine({
      commandLine,
      env: { XDG_CURRENT_DESKTOP: 'Plasma' },
      platform: 'linux',
    });

    expect(commandLine.appendSwitch).toHaveBeenCalledOnce();
    expect(commandLine.appendSwitch).toHaveBeenCalledWith('ozone-platform-hint', 'auto');
  });

  it('does nothing on non-Linux platforms', () => {
    const commandLine = createCommandLine();

    configureChromiumCommandLine({ commandLine, env: {}, platform: 'darwin' });

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(commandLine.hasSwitch).not.toHaveBeenCalled();
  });
});
