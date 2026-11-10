import { describe, expect, it } from 'vitest';
import { envConfigRoot, homeConfigRoot, xdgConfigRoot } from './config-root';

describe('config root resolvers', () => {
  it('keeps existing relative overrides home-based even when cwd is supplied', () => {
    const context = {
      env: { AGENT_HOME: 'custom', XDG_CONFIG_HOME: 'xdg' },
      homeDir: '/home/ada',
      platform: 'linux',
      cwd: '/workspace',
    } as const;

    expect(envConfigRoot('AGENT_HOME', '.agent')(context)).toBe('/home/ada/custom');
    expect(xdgConfigRoot('agent')(context)).toBe('/home/ada/xdg/agent');
    expect(homeConfigRoot('.agent')(context)).toBe('/home/ada/.agent');
  });

  it('resolves home-relative provider directories', () => {
    expect(homeConfigRoot('.agent')({ env: {}, homeDir: '/home/ada', platform: 'linux' })).toBe(
      '/home/ada/.agent'
    );
  });

  it('honors provider home overrides', () => {
    expect(
      envConfigRoot(
        'AGENT_HOME',
        '.agent'
      )({
        env: { AGENT_HOME: '/configs/agent' },
        homeDir: '/home/ada',
        platform: 'linux',
      })
    ).toBe('/configs/agent');
  });

  it('uses XDG_CONFIG_HOME on POSIX and APPDATA on Windows', () => {
    const resolver = xdgConfigRoot('agent');
    expect(
      resolver({
        env: { XDG_CONFIG_HOME: '/configs' },
        homeDir: '/home/ada',
        platform: 'linux',
      })
    ).toBe('/configs/agent');
    expect(
      resolver({
        env: { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' },
        homeDir: 'C:\\Users\\Ada',
        platform: 'windows',
      })
    ).toBe('C:\\Users\\Ada\\AppData\\Roaming\\agent');
  });
});
