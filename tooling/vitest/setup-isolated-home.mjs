/**
 * Vitest setup file that gives every test file its own empty home directory, so tests never
 * read or write the developer's per-user state: ~/.gitconfig, ~/.config, ~/.ssh, ~/.emdash,
 * the Windows app-data folders and the like. See isolateHomeEnv for what the environment
 * changes.
 *
 * The global git config stays at its default path inside the new home, so a subprocess whose
 * environment is filtered down to HOME still reads it. That config holds only an identity, so
 * commits never depend on what git can detect about the machine.
 *
 * Tests that drive the real checkout's toolchain (pnpm, Nx) need the developer's home and must
 * not use this file.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { isolateHomeEnv } from './isolated-home.mjs';

// Real homes are canonical paths; tmpdir() is not on macOS (/var -> /private/var).
const home = realpathSync(mkdtempSync(join(tmpdir(), 'emdash-test-home-')));
writeFileSync(
  join(home, '.gitconfig'),
  '[user]\n\tname = Emdash Tests\n\temail = tests@emdash.invalid\n'
);
isolateHomeEnv(process.env, home, process.platform);

afterAll(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});
