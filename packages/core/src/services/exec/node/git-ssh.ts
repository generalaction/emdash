import { randomBytes } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** OpenSSH that fails instead of prompting for passwords, passphrases, or host keys. */
export const BATCH_SSH_COMMAND = 'ssh -o BatchMode=yes';

const BATCH_SSH_SCRIPT = `#!/bin/sh\nexec ${BATCH_SSH_COMMAND} "$@"\n`;

/** Directories below the home directory that hold the wrapper. */
const WRAPPER_DIRECTORIES = ['.emdash', 'git-ssh'];

/**
 * Absolute path of an executable named `ssh` that runs `ssh -o BatchMode=yes "$@"`, for use
 * as `GIT_SSH`. Because of its name, git still treats it as OpenSSH and passes `-p` and
 * `-o SendEnv=GIT_PROTOCOL`. Its directory is never on PATH, so the inner `ssh` is the real
 * client.
 *
 * The wrapper lives under `home`, the home directory git runs with, never in a shared temp
 * root: there a temp cleaner can delete it and another user can put their own `ssh` at the
 * same path, so no check could keep the path trustworthy until git runs it. Git already runs
 * whatever SSH command the global config in `home` names, so the wrapper adds no new trust.
 * Every directory from `home` down to the wrapper must still be changeable only by the user or
 * root, the rule OpenSSH applies to its own config files, and all of it is checked on every
 * call; the wrapper is rewritten when missing or stale. Returns undefined when no such
 * wrapper can be set up, e.g. on a `noexec` home.
 */
export function batchSshProgram(home: string): string | undefined {
  try {
    if (!isAbsolute(home)) return undefined;
    let dir = realpathSync(home);
    if (!isTrusted(lstatSync(dir))) return undefined;
    for (const name of WRAPPER_DIRECTORIES) {
      dir = join(dir, name);
      createDirectory(dir);
      if (!isTrusted(lstatSync(dir))) return undefined;
    }
    const program = join(dir, 'ssh');
    if (!isCurrentWrapper(program)) writeWrapper(dir, program);
    // On Linux, access(2) also rejects execution from a noexec mount.
    accessSync(program, constants.X_OK);
    return program;
  } catch {
    return undefined;
  }
}

function createDirectory(dir: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/**
 * A real directory, not a symlink, that only this user or root can change. Windows profile
 * directories are per-user and carry no POSIX ownership.
 */
function isTrusted(stats: Stats): boolean {
  if (!stats.isDirectory()) return false;
  if (process.platform === 'win32') return true;
  return (stats.uid === process.getuid?.() || stats.uid === 0) && (stats.mode & 0o022) === 0;
}

function isCurrentWrapper(program: string): boolean {
  try {
    const stats = lstatSync(program);
    if (!stats.isFile()) return false;
    if (
      process.platform !== 'win32' &&
      (stats.uid !== process.getuid?.() || (stats.mode & 0o777) !== 0o700)
    ) {
      return false;
    }
    return readFileSync(program, 'utf8') === BATCH_SSH_SCRIPT;
  } catch {
    return false;
  }
}

/** Replaces the wrapper atomically, so concurrent processes never run a partial script. */
function writeWrapper(dir: string, program: string): void {
  const staging = join(dir, `ssh-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    const fd = openSync(staging, 'wx', 0o700);
    try {
      writeFileSync(fd, BATCH_SSH_SCRIPT);
      // The umask applies to the open mode and may have cleared the execute bit.
      fchmodSync(fd, 0o700);
    } finally {
      closeSync(fd);
    }
    renameSync(staging, program);
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
}
