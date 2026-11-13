import { join } from 'node:path';

/**
 * Changes `env` in place into the environment of a fresh user whose home directory is `home`,
 * so nothing started with it finds the developer's per-user state.
 *
 * HOME (and USERPROFILE on Windows) moves to `home`, and Node's os.homedir() reads the same
 * variable. Git and other tools also locate per-user state through their own variables, so:
 * - inherited GIT_* variables (GIT_CONFIG_GLOBAL, GIT_SSH_COMMAND, GIT_DIR from a hook, ...) are
 *   dropped, and GIT_CONFIG_NOSYSTEM hides the machine-wide git config;
 * - XDG base directories are dropped, so they default to paths inside `home`;
 * - on Windows, APPDATA and LOCALAPPDATA move to their usual places inside `home`. Windows has
 *   no fallback for them, so they are set rather than dropped.
 *
 * Tools installed per user are still found through PATH, which stays unchanged.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @param {NodeJS.Platform} platform
 */
export function isolateHomeEnv(env, home, platform) {
  for (const name of Object.keys(env)) {
    if (name.startsWith('GIT_') || /^XDG_(CONFIG|DATA|STATE|CACHE)_HOME$/.test(name)) {
      delete env[name];
    }
  }
  env.HOME = home;
  env.GIT_CONFIG_NOSYSTEM = '1';
  if (platform === 'win32') {
    env.USERPROFILE = home;
    env.APPDATA = join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = join(home, 'AppData', 'Local');
  }
}
