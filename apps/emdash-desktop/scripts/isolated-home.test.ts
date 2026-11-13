import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolateHomeEnv } from '../../../tooling/vitest/isolated-home.mjs';

const home = join('/tmp', 'emdash-test-home');

describe('isolateHomeEnv', () => {
  it('moves the home and drops inherited git and XDG home settings', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/dev',
      GIT_CONFIG_GLOBAL: '/home/dev/.gitconfig',
      GIT_CONFIG_PARAMETERS: "'commit.gpgsign'='true'",
      GIT_SSH_COMMAND: 'ssh -F /home/dev/.ssh/work',
      GIT_DIR: '/repo/.git',
      XDG_CONFIG_HOME: '/home/dev/.config',
      XDG_DATA_HOME: '/home/dev/.local/share',
      XDG_STATE_HOME: '/home/dev/.local/state',
      XDG_CACHE_HOME: '/home/dev/.cache',
      XDG_RUNTIME_DIR: '/run/user/1000',
    };

    isolateHomeEnv(env, home, 'linux');

    expect(env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      XDG_RUNTIME_DIR: '/run/user/1000',
    });
  });

  it('moves the Windows profile and its app-data folders into the home', () => {
    const env: NodeJS.ProcessEnv = {
      Path: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\dev',
      APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
      TEMP: 'C:\\Users\\dev\\AppData\\Local\\Temp',
      GIT_CONFIG_GLOBAL: 'C:\\Users\\dev\\.gitconfig',
    };

    isolateHomeEnv(env, home, 'win32');

    expect(env).toEqual({
      Path: 'C:\\Windows\\System32',
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      TEMP: 'C:\\Users\\dev\\AppData\\Local\\Temp',
      GIT_CONFIG_NOSYSTEM: '1',
    });
  });
});
