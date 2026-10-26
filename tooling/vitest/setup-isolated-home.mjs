/**
 * Vitest setup file that gives every test file its own empty home directory, so tests never
 * read or write the developer's per-user state: ~/.gitconfig, ~/.config, ~/.ssh, ~/.emdash and
 * the like. Git, SSH and app code all find the home through HOME (USERPROFILE on Windows), and
 * Node's os.homedir() reads the same variable.
 *
 * Inherited GIT_* variables (GIT_CONFIG_GLOBAL, GIT_SSH_COMMAND, GIT_DIR from a hook, ...) and
 * XDG base directories would still point git and other tools at the developer's setup, so they
 * are dropped, and GIT_CONFIG_NOSYSTEM hides the machine-wide git config. The global git config
 * stays at its default path inside the new home, so a subprocess whose environment is filtered
 * down to HOME still reads it. That config holds only an identity, so commits never depend on
 * what git can detect about the machine.
 *
 * Tests that drive the real checkout's toolchain (pnpm, Nx) need the developer's home and must
 * not use this file.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Real homes are canonical paths; tmpdir() is not on macOS (/var -> /private/var).
const home = realpathSync(mkdtempSync(join(tmpdir(), 'emdash-test-home-')));
writeFileSync(
  join(home, '.gitconfig'),
  '[user]\n\tname = Emdash Tests\n\temail = tests@emdash.invalid\n'
);

for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_') || /^XDG_(CONFIG|DATA|STATE|CACHE)_HOME$/.test(name)) {
    delete process.env[name];
  }
}
process.env.HOME = home;
if (process.platform === 'win32') process.env.USERPROFILE = home;
process.env.GIT_CONFIG_NOSYSTEM = '1';

afterAll(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});
