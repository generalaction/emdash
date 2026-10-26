import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoundExec } from '#services/exec/api';
import { createNonInteractiveGitExec, nonInteractiveGitEnv } from './git-exec';

const posix = process.platform !== 'win32';
const BATCH_SSH_SCRIPT = '#!/bin/sh\nexec ssh -o BatchMode=yes "$@"\n';

function sshProgram(env: NodeJS.ProcessEnv): string {
  expect(env.GIT_SSH).toEqual(expect.any(String));
  return env.GIT_SSH ?? '';
}

describe('nonInteractiveGitEnv', () => {
  it('disables prompts and pins the C locale', () => {
    expect(
      nonInteractiveGitEnv({
        LC_ALL: 'de_DE.UTF-8',
        LANG: 'de_DE.UTF-8',
        GIT_ASKPASS: '/usr/bin/askpass',
        SSH_ASKPASS: '/usr/bin/ssh-askpass',
      })
    ).toMatchObject({
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
    });
  });

  it('defaults SSH to batch mode through GIT_SSH, below core.sshCommand', () => {
    const env = nonInteractiveGitEnv({});

    expect(env).not.toHaveProperty('GIT_SSH_COMMAND');
    const program = sshProgram(env);
    expect(basename(program)).toBe('ssh');
    expect(readFileSync(program, 'utf8')).toBe(BATCH_SSH_SCRIPT);
    expect(nonInteractiveGitEnv({}).GIT_SSH).toBe(program);
  });

  it('keeps an SSH program the caller configured', () => {
    const command = nonInteractiveGitEnv({ GIT_SSH_COMMAND: 'ssh -F custom-config' });
    expect(command.GIT_SSH_COMMAND).toBe('ssh -F custom-config');
    expect(command).not.toHaveProperty('GIT_SSH');

    const program = nonInteractiveGitEnv({ GIT_SSH: '/opt/bin/plink' });
    expect(program.GIT_SSH).toBe('/opt/bin/plink');
    expect(program).not.toHaveProperty('GIT_SSH_COMMAND');
  });

  it('treats empty SSH variables as unset', () => {
    const env = nonInteractiveGitEnv({ GIT_SSH_COMMAND: '', GIT_SSH: '' });

    expect(env).not.toHaveProperty('GIT_SSH_COMMAND');
    expect(basename(sshProgram(env))).toBe('ssh');
  });
});

// TMPDIR picks the temp root on POSIX; each test gets its own so none touches the shared one.
describe.skipIf(!posix)('batch SSH wrapper', () => {
  const previousTmpdir = process.env.TMPDIR;
  let root: string;
  let dir: string;

  function expectBatchCommandFallback(env: NodeJS.ProcessEnv): void {
    expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes');
    expect(env).not.toHaveProperty('GIT_SSH');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'emdash-tmp-root-'));
    dir = join(root, `emdash-git-ssh-${process.getuid?.()}`);
    process.env.TMPDIR = root;
  });

  afterEach(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });

  it('lives in a directory private to the current user', () => {
    const program = sshProgram(nonInteractiveGitEnv({}));

    expect(program).toBe(join(dir, 'ssh'));
    expect(statSync(program).mode & 0o777).toBe(0o700);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('is recreated after a temp cleaner removes it', () => {
    const program = sshProgram(nonInteractiveGitEnv({}));
    rmSync(dir, { recursive: true });

    expect(sshProgram(nonInteractiveGitEnv({}))).toBe(program);
    expect(readFileSync(program, 'utf8')).toBe(BATCH_SSH_SCRIPT);
  });

  it('replaces a stale wrapper without leaving staging files', () => {
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nexec ssh "$@"\n', { mode: 0o700 });

    const program = sshProgram(nonInteractiveGitEnv({}));

    expect(readFileSync(program, 'utf8')).toBe(BATCH_SSH_SCRIPT);
    expect(readdirSync(dir)).toEqual(['ssh']);
  });

  it('falls back when other users could write to the directory', () => {
    mkdirSync(dir);
    chmodSync(dir, 0o777);
    writeFileSync(join(dir, 'ssh'), BATCH_SSH_SCRIPT, { mode: 0o700 });

    expectBatchCommandFallback(nonInteractiveGitEnv({}));
  });

  it('falls back when the directory is a symlink', () => {
    const target = join(root, 'elsewhere');
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, dir);

    expectBatchCommandFallback(nonInteractiveGitEnv({}));
    expect(readdirSync(target)).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)('falls back when the temp root is not writable', () => {
    chmodSync(root, 0o500);

    expectBatchCommandFallback(nonInteractiveGitEnv({}));
  });
});

describe('createNonInteractiveGitExec', () => {
  it('runs git with the non-interactive environment', () => {
    expect(createNonInteractiveGitExec(process.cwd()).env).toEqual(
      nonInteractiveGitEnv(process.env)
    );
  });
});

describe.skipIf(!posix)('SSH program selection with git', () => {
  let root: string;
  let router: string;
  let log: string;
  let base: NodeJS.ProcessEnv;

  /** Records its argv like a fake ssh, then fails so git gives up. */
  function writeRecorder(path: string, name: string): void {
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "$SSH_LOG"\nexit 1\n`);
    chmodSync(path, 0o755);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'emdash-git-ssh-test-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeRecorder(join(bin, 'ssh'), 'ssh');
    router = join(root, 'router');
    writeRecorder(router, 'router');
    log = join(root, 'ssh.log');
    base = {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      HOME: root,
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      SSH_LOG: log,
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function sshInvocations(env: NodeJS.ProcessEnv, cwd = root): Promise<string[]> {
    const git = createBoundExec({ file: 'git', cwd, env: nonInteractiveGitEnv(env) });
    await expect(
      git.exec(['ls-remote', 'ssh://git@git.example.invalid:2222/group/repo.git'])
    ).rejects.toThrow();
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  }

  function setGlobalSshCommand(command: string): void {
    execFileSync('git', ['config', '--file', join(root, 'gitconfig'), 'core.sshCommand', command]);
  }

  it('runs the real ssh in batch mode, still treated as OpenSSH', async () => {
    const calls = await sshInvocations(base);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^ssh -o BatchMode=yes /);
    expect(calls[0]).toContain('-o SendEnv=GIT_PROTOCOL');
    expect(calls[0]).toContain('-p 2222 git@git.example.invalid');
  });

  it('lets a global core.sshCommand win over the default', async () => {
    setGlobalSshCommand(`'${router}' global`);

    const calls = await sshInvocations(base);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^router global /);
  });

  it('lets a repository core.sshCommand win over the default', async () => {
    const repo = join(root, 'repo');
    execFileSync('git', ['init', '-q', repo], { env: base });
    execFileSync('git', ['-C', repo, 'config', 'core.sshCommand', `'${router}' repository`], {
      env: base,
    });

    const calls = await sshInvocations(base, repo);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^router repository /);
  });

  it('honors GIT_SSH_COMMAND from the environment over core.sshCommand', async () => {
    setGlobalSshCommand(`'${router}' global`);

    const calls = await sshInvocations({ ...base, GIT_SSH_COMMAND: `'${router}' env` });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^router env /);
  });

  it('honors GIT_SSH from the environment', async () => {
    const calls = await sshInvocations({ ...base, GIT_SSH: router });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^router /);
  });
});
