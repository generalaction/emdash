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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** OpenSSH that fails instead of prompting for passwords, passphrases, or host keys. */
export const BATCH_SSH_COMMAND = 'ssh -o BatchMode=yes';

const BATCH_SSH_SCRIPT = `#!/bin/sh\nexec ${BATCH_SSH_COMMAND} "$@"\n`;

let wrapper: { root: string; program: string | undefined } | undefined;

/**
 * Absolute path of an executable named `ssh` that runs `ssh -o BatchMode=yes "$@"`, for use
 * as `GIT_SSH`. Because of its name, git still treats it as OpenSSH and passes `-p` and
 * `-o SendEnv=GIT_PROTOCOL`. Its directory is never on PATH, so the inner `ssh` is the real
 * client.
 *
 * Every Emdash process of the user shares one wrapper in a private directory under the temp
 * root; it is rewritten if missing or stale, e.g. after a temp cleaner ran. Returns undefined
 * when no trustworthy executable wrapper can be set up there, e.g. on a `noexec` mount; that
 * outcome is kept for the process rather than retried on every git call.
 */
export function batchSshProgram(): string | undefined {
  const root = tmpdir();
  if (wrapper?.root === root && (!wrapper.program || isExecutable(wrapper.program))) {
    return wrapper.program;
  }
  wrapper = { root, program: ensureWrapper(root) };
  return wrapper.program;
}

function ensureWrapper(root: string): string | undefined {
  try {
    const dir = join(root, `emdash-git-ssh-${process.getuid?.() ?? 'user'}`);
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!isPrivateDirectory(dir)) return undefined;
    const program = join(dir, 'ssh');
    if (!isCurrentWrapper(program)) writeWrapper(dir, program);
    // On Linux, access(2) also rejects execution from a noexec mount.
    accessSync(program, constants.X_OK);
    return program;
  } catch {
    return undefined;
  }
}

/**
 * The temp root may be shared with other users (`/tmp`), so only trust a real directory, not
 * a symlink, that this user owns and nobody else can write to. Windows temp directories are
 * per-user and carry no POSIX ownership.
 */
function isPrivateDirectory(dir: string): boolean {
  const stats = lstatSync(dir);
  if (!stats.isDirectory()) return false;
  if (process.platform === 'win32') return true;
  return stats.uid === process.getuid?.() && (stats.mode & 0o077) === 0;
}

function isCurrentWrapper(program: string): boolean {
  try {
    return (
      lstatSync(program).isFile() &&
      readFileSync(program, 'utf8') === BATCH_SSH_SCRIPT &&
      isExecutable(program)
    );
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

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
