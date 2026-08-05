import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import {
  buildTmuxShellLine,
  decodeLegacyTmuxSessionName,
  makeLegacyTmuxSessionName,
  makeTmuxSession,
  TMUX_LEAF_ID_OPTION,
  TMUX_PROJECT_ID_OPTION,
  TMUX_TASK_ID_OPTION,
} from './tmux-session-name';

const execFileAsync = promisify(execFile);

async function waitForPath(candidate: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(candidate)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${candidate}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs = 2_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for child ${child.pid ?? 'unknown'} to exit`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function installBlockingRmdirStub(tempDir: string): void {
  const rmdirStub = path.join(tempDir, 'rmdir');
  writeFileSync(
    rmdirStub,
    `#!/bin/sh
if [ "$1" = "$TMUX_RACE_GUARD" ] && [ ! -e "$TMUX_RACE_RELEASE" ]; then
  : > "$TMUX_RACE_BLOCKED"
  while [ ! -e "$TMUX_RACE_RELEASE" ]; do
    sleep 0.01
  done
fi
PATH=/usr/bin:/bin
exec rmdir "$@"
`
  );
  chmodSync(rmdirStub, 0o755);
}

function installBlockingClaimLnStub(tempDir: string): void {
  const lnStub = path.join(tempDir, 'ln');
  writeFileSync(
    lnStub,
    `#!/bin/sh
original_parent=$PPID
case "$2" in
  *.claim.*)
    if [ ! -e "$TMUX_KILL_CLAIM_ONCE" ]; then
      : > "$TMUX_KILL_CLAIM_ONCE"
      : > "$TMUX_KILL_CLAIM_BLOCKED"
      while [ ! -e "$TMUX_KILL_CLAIM_RELEASE" ]; do
        sleep 0.01
      done
      kill -0 "$original_parent" 2>/dev/null || exit 1
    fi
    ;;
esac
PATH=/usr/bin:/bin
exec ln "$@"
`
  );
  chmodSync(lnStub, 0o755);
}

function installStatefulTmuxStub(tempDir: string): {
  callsFile: string;
  stateFile: string;
} {
  const tmuxStub = path.join(tempDir, 'tmux');
  const callsFile = path.join(tempDir, 'calls.log');
  const stateFile = path.join(tempDir, 'sessions.tsv');
  writeFileSync(callsFile, '');
  writeFileSync(stateFile, '');
  writeFileSync(
    tmuxStub,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$TMUX_CALLS"
if [ "$1" = "-u" ]; then shift; fi

case "$1" in
  list-sessions)
    format=$3
    if [ -n "\${TMUX_TERM_OWNER_LOCK:-}" ]; then
      owner=$(sed -n '1p' "$TMUX_TERM_OWNER_LOCK")
      kill -TERM "$owner"
      exit 0
    fi
    if [ "\${TMUX_OLD_FORMAT:-0}" = 1 ] && [ "$format" != '#{session_name}' ]; then
      exit 1
    fi
    if [ "\${TMUX_RICH_EMPTY:-0}" = 1 ] && [ "$format" != '#{session_name}' ]; then
      exit 0
    fi
    if [ "$format" = '#{session_name}' ]; then
      cut -f1 "$TMUX_STATE"
    elif [ "\${TMUX_EMPTY_FORMAT:-0}" = 1 ]; then
      awk -F '\\t' '{ printf "%s\\t\\t\\t\\n", $1 }' "$TMUX_STATE"
    else
      cat "$TMUX_STATE"
    fi
    ;;
  show-options)
    target=$3
    awk -F '\\t' -v target="$target" '
      $1 == target {
        if ($2 != "") print "${TMUX_PROJECT_ID_OPTION} " $2
        if ($3 != "") print "${TMUX_TASK_ID_OPTION} " $3
        if ($4 != "") print "${TMUX_LEAF_ID_OPTION} " $4
      }
    ' "$TMUX_STATE"
    ;;
  has-session)
    target=$3
    awk -F '\\t' -v target="$target" '$1 == target { found = 1 } END { exit !found }' "$TMUX_STATE"
    ;;
  new-session)
    shift
    name=
    project=
    task=
    leaf=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -s) shift; name=$1 ;;
        ${TMUX_PROJECT_ID_OPTION}) shift; project=$1 ;;
        ${TMUX_TASK_ID_OPTION}) shift; task=$1 ;;
        ${TMUX_LEAF_ID_OPTION}) shift; leaf=$1 ;;
      esac
      shift
    done
    if [ -n "\${TMUX_NEW_DELAY:-}" ]; then sleep "$TMUX_NEW_DELAY"; fi
    if awk -F '\\t' -v target="$name" '$1 == target { found = 1 } END { exit !found }' "$TMUX_STATE"; then
      exit 1
    fi
    printf '%s\\t%s\\t%s\\t%s\\n' "$name" "$project" "$task" "$leaf" >> "$TMUX_STATE"
    ;;
esac
`
  );
  chmodSync(tmuxStub, 0o755);
  return { callsFile, stateFile };
}

function tmuxStubEnv(
  tempDir: string,
  files: { callsFile: string; stateFile: string },
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${tempDir}:/usr/bin:/bin`,
    TMPDIR: tempDir,
    TMUX_CALLS: files.callsFile,
    TMUX_STATE: files.stateFile,
    ...extra,
  };
}

describe('makeTmuxSession', () => {
  it('uses a short recognizable workspace label and deterministic collision-resistant token', () => {
    const sessionId = makePtySessionId('project-1', 'task-2', 'conversation-3');

    const session = makeTmuxSession(sessionId, '/tmp/My workspace.with punctuation');

    expect(session).toMatchObject({
      projectId: 'project-1',
      taskId: 'task-2',
      leafId: 'conversation-3',
    });
    expect(session.name).toMatch(/^emdash-My-workspace-with-punctu-[A-Za-z0-9_-]{10}$/);
    expect(session.name.length).toBeLessThanOrEqual(42);
    expect(makeTmuxSession(sessionId, '/tmp/My workspace.with punctuation')).toEqual(session);
    expect(makeTmuxSession(`${sessionId}-other`, '/tmp/workspace').name).not.toBe(session.name);
  });

  it('rejects malformed PTY session ids', () => {
    expect(() => makeTmuxSession('not-a-pty-id', '/tmp/workspace')).toThrow(
      'Invalid PTY session id'
    );
  });
});

describe('buildTmuxShellLine', () => {
  const session = makeTmuxSession(
    makePtySessionId('project-1', 'task-2', 'conversation-3'),
    '/tmp/task-workspace'
  );

  it('atomically tags a new session before configuring and attaching', () => {
    const result = buildTmuxShellLine(session, 'exec /bin/zsh -il');

    expect(result).toContain("'/bin/sh' '-c'");
    expect(result).toContain('preferred_name=$1');
    expect(result).toContain('legacy_name=$2');
    expect(result).toContain(
      `new-session -d -s "$session_name" "$command_line" \\; set-option -t "$session_name" ${TMUX_PROJECT_ID_OPTION}`
    );
    expect(result).toContain(`${TMUX_TASK_ID_OPTION} "$task_id"`);
    expect(result).toContain(`${TMUX_LEAF_ID_OPTION} "$leaf_id"`);
    expect(result).toContain('tmux set-option -t "$session_name" mouse on');
    expect(result).toContain('tmux set-option -t "$session_name" history-limit 100000');
    expect(result).toContain('exec tmux -u attach-session -t "$session_name"');
    expect(result.indexOf('new-session')).toBeLessThan(result.indexOf('mouse on'));
    expect(result.indexOf('history-limit')).toBeLessThan(result.indexOf('attach-session'));
  });

  it('passes identity and command values as safely quoted positional argv', () => {
    const hostileSession = {
      name: 'emdash-work-$(touch /tmp/unsafe)',
      projectId: 'project`whoami`',
      taskId: 'task $HOME',
      leafId: 'leaf;echo unsafe',
    };
    const result = buildTmuxShellLine(hostileSession, "printf '$HOME' && echo `whoami`");

    expect(result).toContain("'emdash-work-$(touch /tmp/unsafe)'");
    expect(result).toContain("'project`whoami`'");
    expect(result).toContain("'task $HOME'");
    expect(result).toContain("'leaf;echo unsafe'");
    expect(result).toContain("'printf '\\''$HOME'\\'' && echo `whoami`'");
  });

  it('does not evaluate shell syntax embedded in tmux values or the wrapped command', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-argv-'));
    const tmuxStub = path.join(tempDir, 'tmux');
    const callsFile = path.join(tempDir, 'calls.log');
    const injectionMarker = path.join(tempDir, 'injected');
    try {
      writeFileSync(
        tmuxStub,
        `#!/bin/sh
{
  printf 'CALL\n'
  for arg do printf 'ARG=<%s>\n' "$arg"; done
} >> "$TMUX_CALLS"
if [ "$1" = "has-session" ]; then exit 1; fi
exit 0
`
      );
      chmodSync(tmuxStub, 0o755);
      const hostileCommand = `printf ready; touch ${injectionMarker}`;
      const line = buildTmuxShellLine(
        {
          name: `emdash-work-$(touch ${injectionMarker})`,
          projectId: `project-$(touch ${injectionMarker})`,
          taskId: 'task; touch unsafe',
          leafId: 'leaf `touch unsafe`',
        },
        hostileCommand
      );

      execFileSync('/bin/sh', ['-c', line], {
        env: {
          ...process.env,
          PATH: `${tempDir}:/usr/bin:/bin`,
          TMUX_CALLS: callsFile,
        },
      });

      expect(existsSync(injectionMarker)).toBe(false);
      const calls = readFileSync(callsFile, 'utf8');
      expect(calls).toContain(`ARG=<${hostileCommand}>`);
      expect(calls).toContain(`ARG=<project-$(touch ${injectionMarker})>`);
      expect(calls).toContain('ARG=<task; touch unsafe>');
      expect(calls).toContain('ARG=<leaf `touch unsafe`>');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('checks the legacy encoded name before creating a new friendly session', () => {
    const result = buildTmuxShellLine(session, 'echo ready');
    const legacyName = makeLegacyTmuxSessionName(
      makePtySessionId(session.projectId, session.taskId, session.leafId)
    );

    expect(result).toContain('tmux has-session -t "$legacy_name"');
    expect(result).toContain(`'${legacyName}'`);
  });

  it('resumes the session found by persisted identity after the workspace label changes', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-rename-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('project-1', 'task-2', 'conversation-3');
      const original = makeTmuxSession(sessionId, '/tmp/original-workspace');
      const renamed = makeTmuxSession(sessionId, '/tmp/renamed-workspace');
      writeFileSync(
        files.stateFile,
        `${original.name}\t${original.projectId}\t${original.taskId}\t${original.leafId}\n`
      );

      execFileSync('/bin/sh', ['-c', buildTmuxShellLine(renamed, 'echo should-not-start')], {
        env: tmuxStubEnv(tempDir, files),
      });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls).not.toContain('new-session');
      expect(calls).toContain(`attach-session -t ${original.name}`);
      expect(calls).not.toContain(`attach-session -t ${renamed.name}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('serializes concurrent resumes with different workspace labels into one session', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-concurrent-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('project-race', 'task-race', 'leaf-race');
      const first = makeTmuxSession(sessionId, '/tmp/first-label');
      const second = makeTmuxSession(sessionId, '/tmp/second-label');
      const env = tmuxStubEnv(tempDir, files, { TMUX_NEW_DELAY: '0.2' });

      await Promise.all([
        execFileAsync('/bin/sh', ['-c', buildTmuxShellLine(first, 'echo first')], { env }),
        execFileAsync('/bin/sh', ['-c', buildTmuxShellLine(second, 'echo second')], { env }),
      ]);

      const state = readFileSync(files.stateFile, 'utf8').trim().split('\n');
      const calls = readFileSync(files.callsFile, 'utf8');
      const creationCalls = calls.split('\n').filter((call) => call.includes('new-session'));
      const attachTargets = calls
        .split('\n')
        .filter((call) => call.includes('attach-session'))
        .map((call) => call.match(/-t ([^ ]+)$/)?.[1]);

      expect(state).toHaveLength(1);
      expect(creationCalls).toHaveLength(1);
      expect(attachTargets).toHaveLength(2);
      expect(new Set(attachTargets)).toEqual(new Set([state[0].split('\t')[0]]));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resumes an untagged legacy encoded session instead of creating a friendly duplicate', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-legacy-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('legacy-project', 'legacy-task', 'legacy-leaf');
      const legacyName = makeLegacyTmuxSessionName(sessionId);
      const session = makeTmuxSession(sessionId, '/tmp/friendly-workspace');
      writeFileSync(files.stateFile, `${legacyName}\t\t\t\n`);

      execFileSync('/bin/sh', ['-c', buildTmuxShellLine(session, 'echo should-not-start')], {
        env: tmuxStubEnv(tempDir, files),
      });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls).not.toContain('new-session');
      expect(calls).toContain(`attach-session -t ${legacyName}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses show-options identity lookup when old tmux rejects rich list formats', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-old-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('old-project', 'old-task', 'old-leaf');
      const original = makeTmuxSession(sessionId, '/tmp/old-label');
      const renamed = makeTmuxSession(sessionId, '/tmp/new-label');
      writeFileSync(
        files.stateFile,
        `${original.name}\t${original.projectId}\t${original.taskId}\t${original.leafId}\n`
      );

      execFileSync('/bin/sh', ['-c', buildTmuxShellLine(renamed, 'echo should-not-start')], {
        env: tmuxStubEnv(tempDir, files, { TMUX_OLD_FORMAT: '1' }),
      });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls).toContain('list-sessions -F #{session_name}');
      expect(calls).toContain(`show-options -t ${original.name}`);
      expect(calls).not.toContain('new-session');
      expect(calls).toContain(`attach-session -t ${original.name}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses show-options when old tmux accepts rich formats but expands user options empty', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-old-empty-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('old-project', 'old-task', 'old-leaf');
      const original = makeTmuxSession(sessionId, '/tmp/old-empty-label');
      const renamed = makeTmuxSession(sessionId, '/tmp/new-empty-label');
      writeFileSync(
        files.stateFile,
        `${original.name}\t${original.projectId}\t${original.taskId}\t${original.leafId}\n`
      );

      execFileSync('/bin/sh', ['-c', buildTmuxShellLine(renamed, 'echo should-not-start')], {
        env: tmuxStubEnv(tempDir, files, { TMUX_EMPTY_FORMAT: '1' }),
      });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls).toContain(`show-options -t ${original.name}`);
      expect(calls).not.toContain('new-session');
      expect(calls).toContain(`attach-session -t ${original.name}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the names fallback when an old tmux returns success with no rich-format output', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-old-success-empty-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('empty-project', 'empty-task', 'empty-leaf');
      const original = makeTmuxSession(sessionId, '/tmp/old-success-empty-label');
      const renamed = makeTmuxSession(sessionId, '/tmp/new-success-empty-label');
      writeFileSync(
        files.stateFile,
        `${original.name}\t${original.projectId}\t${original.taskId}\t${original.leafId}\n`
      );

      execFileSync('/bin/sh', ['-c', buildTmuxShellLine(renamed, 'echo should-not-start')], {
        env: tmuxStubEnv(tempDir, files, { TMUX_RICH_EMPTY: '1' }),
      });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls).toContain('list-sessions -F #{session_name}');
      expect(calls).toContain(`show-options -t ${original.name}`);
      expect(calls).not.toContain('new-session');
      expect(calls).toContain(`attach-session -t ${original.name}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('recovers a lock orphaned by a crashed wrapper before creating the session', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-stale-lock-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('stale-project', 'stale-task', 'stale-leaf');
      const session = makeTmuxSession(sessionId, '/tmp/stale-lock-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);
      writeFileSync(lockFile, '99999999\n');

      execFileSync('/bin/sh', ['-c', buildTmuxShellLine(session, 'echo create-once')], {
        env: tmuxStubEnv(tempDir, files),
      });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls.match(/new-session/g)).toHaveLength(1);
      expect(calls).toContain(`attach-session -t ${session.name}`);
      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reclaims a stable stale lock when its live pid belongs to a different process instance', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-reused-pid-lock-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('reused-project', 'reused-task', 'reused-leaf');
      const session = makeTmuxSession(sessionId, '/tmp/reused-pid-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);
      const staleOwnerCandidate = `${lockFile}.${process.pid}`;
      writeFileSync(lockFile, `${process.pid}\nMon Jan  1 00:00:00 2001\n`);
      linkSync(lockFile, staleOwnerCandidate);

      const child = execFile(
        '/bin/sh',
        ['-c', `exec ${buildTmuxShellLine(session, 'echo create-once')}`],
        { env: tmuxStubEnv(tempDir, files) }
      );
      expect(await waitForChildExit(child)).toEqual({ code: 0, signal: null });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls.match(/new-session/g)).toHaveLength(1);
      expect(calls).toContain(`attach-session -t ${session.name}`);
      expect(existsSync(lockFile)).toBe(false);
      expect(existsSync(staleOwnerCandidate)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('serializes competing stale cleaners and keeps replacement owners behind the cleanup guard', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-cleaner-race-'));
    const children: ChildProcess[] = [];
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('race-project', 'race-task', 'race-leaf');
      const session = makeTmuxSession(sessionId, '/tmp/cleaner-race-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);
      const cleanupGuard = `${lockFile}.cleanup`;
      const blocked = path.join(tempDir, 'cleanup-guard-release-blocked');
      const release = path.join(tempDir, 'release-cleanup-guard');
      const staleOwnerCandidate = `${lockFile}.${process.pid}`;
      writeFileSync(lockFile, `${process.pid}\nMon Jan  1 00:00:00 2001\n`);
      linkSync(lockFile, staleOwnerCandidate);
      installBlockingRmdirStub(tempDir);
      const env = tmuxStubEnv(tempDir, files, {
        TMUX_NEW_DELAY: '0.2',
        TMUX_RACE_GUARD: cleanupGuard,
        TMUX_RACE_BLOCKED: blocked,
        TMUX_RACE_RELEASE: release,
      });
      const spawnWrapper = () => {
        const child = execFile(
          '/bin/sh',
          ['-c', `exec ${buildTmuxShellLine(session, 'echo create-once')}`],
          { env }
        );
        children.push(child);
        return child;
      };

      // A and B both contend to clean the same stale inode. The sole cleaner
      // is paused after deleting it but before releasing the guard.
      spawnWrapper();
      spawnWrapper();
      await waitForPath(blocked, 4_000);
      expect(existsSync(cleanupGuard)).toBe(true);
      expect(existsSync(lockFile)).toBe(false);

      // C arrives in the exact replacement window. It must remain behind the
      // guard rather than publishing a lock that a delayed cleaner can unlink.
      const replacement = spawnWrapper();
      if (!replacement.pid) throw new Error('Replacement wrapper child has no pid');
      await waitForPath(`${lockFile}.${replacement.pid}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(existsSync(lockFile)).toBe(false);

      writeFileSync(release, 'release\n');
      expect(await Promise.all(children.map((child) => waitForChildExit(child, 4_000)))).toEqual([
        { code: 0, signal: null },
        { code: 0, signal: null },
        { code: 0, signal: null },
      ]);

      const state = readFileSync(files.stateFile, 'utf8').trim().split('\n');
      const calls = readFileSync(files.callsFile, 'utf8');
      expect(state).toHaveLength(1);
      expect(calls.match(/new-session/g)).toHaveLength(1);
      expect(calls.match(/attach-session/g)).toHaveLength(3);
      expect(existsSync(lockFile)).toBe(false);
      expect(existsSync(cleanupGuard)).toBe(false);
      expect(existsSync(staleOwnerCandidate)).toBe(false);
    } finally {
      for (const child of children) {
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('recovers a nonempty cleanup guard after its sole cleaner is killed', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-killed-cleaner-'));
    let killedCleaner: ChildProcess | undefined;
    try {
      const files = installStatefulTmuxStub(tempDir);
      installBlockingClaimLnStub(tempDir);
      const sessionId = makePtySessionId('killed-project', 'killed-task', 'killed-leaf');
      const session = makeTmuxSession(sessionId, '/tmp/killed-cleaner-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);
      const cleanupGuard = `${lockFile}.cleanup`;
      const staleOwnerCandidate = `${lockFile}.${process.pid}`;
      const claimOnce = path.join(tempDir, 'claim-once');
      const claimBlocked = path.join(tempDir, 'claim-blocked');
      const claimRelease = path.join(tempDir, 'claim-release');
      writeFileSync(lockFile, `${process.pid}\nMon Jan  1 00:00:00 2001\n`);
      linkSync(lockFile, staleOwnerCandidate);
      const env = tmuxStubEnv(tempDir, files, {
        TMUX_KILL_CLAIM_ONCE: claimOnce,
        TMUX_KILL_CLAIM_BLOCKED: claimBlocked,
        TMUX_KILL_CLAIM_RELEASE: claimRelease,
      });

      killedCleaner = execFile(
        '/bin/sh',
        ['-c', `exec ${buildTmuxShellLine(session, 'echo killed-cleaner')}`],
        { env }
      );
      await waitForPath(claimBlocked, 4_000);
      expect(existsSync(cleanupGuard)).toBe(true);
      expect(readdirSync(cleanupGuard).filter((entry) => entry.startsWith('owner.'))).toHaveLength(
        1
      );

      killedCleaner.kill('SIGKILL');
      expect(await waitForChildExit(killedCleaner)).toEqual({ code: null, signal: 'SIGKILL' });
      writeFileSync(claimRelease, 'release\n');

      const recovery = execFile(
        '/bin/sh',
        ['-c', `exec ${buildTmuxShellLine(session, 'echo recovered')}`],
        { env }
      );
      expect(await waitForChildExit(recovery, 4_000)).toEqual({ code: 0, signal: null });

      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls.match(/new-session/g)).toHaveLength(1);
      expect(calls).toContain(`attach-session -t ${session.name}`);
      expect(existsSync(lockFile)).toBe(false);
      expect(existsSync(cleanupGuard)).toBe(false);
      expect(existsSync(staleOwnerCandidate)).toBe(false);
    } finally {
      if (killedCleaner?.exitCode === null) killedCleaner.kill('SIGKILL');
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not treat empty process identities as proof that an orphan guard owner is live', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-empty-guard-identity-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('empty-guard-project', 'empty-guard-task', 'empty-leaf');
      const session = makeTmuxSession(sessionId, '/tmp/empty-guard-identity-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);
      const cleanupGuard = `${lockFile}.cleanup`;
      const falseOwnerCandidate = `${lockFile}.${process.pid}`;
      writeFileSync(falseOwnerCandidate, `${process.pid}\n\n`);
      const inode = statSync(falseOwnerCandidate).ino;
      mkdirSync(cleanupGuard);
      linkSync(falseOwnerCandidate, path.join(cleanupGuard, `owner.${process.pid}.${inode}`));

      const recovery = execFile(
        '/bin/sh',
        ['-c', `exec ${buildTmuxShellLine(session, 'echo recovered-empty-identity')}`],
        { env: tmuxStubEnv(tempDir, files) }
      );
      expect(await waitForChildExit(recovery)).toEqual({ code: 0, signal: null });

      expect(existsSync(cleanupGuard)).toBe(false);
      expect(existsSync(falseOwnerCandidate)).toBe(false);
      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls.match(/new-session/g)).toHaveLength(1);
      expect(calls).toContain(`attach-session -t ${session.name}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('exits on TERM while waiting without releasing another wrapper lock', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-term-waiter-'));
    let child: ChildProcess | undefined;
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('term-project', 'term-task', 'term-waiter');
      const session = makeTmuxSession(sessionId, '/tmp/term-waiter-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);
      const ownerCandidate = `${lockFile}.${process.pid}`;
      const ownerIdentity = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], {
        encoding: 'utf8',
      }).trim();
      writeFileSync(lockFile, `${process.pid}\n${ownerIdentity}\n`);
      linkSync(lockFile, ownerCandidate);

      child = execFile(
        '/bin/sh',
        ['-c', `exec ${buildTmuxShellLine(session, 'echo should-not-run')}`],
        { env: tmuxStubEnv(tempDir, files) }
      );
      if (!child.pid) throw new Error('Wrapper child has no pid');
      const waiterCandidate = `${lockFile}.${child.pid}`;
      await waitForPath(waiterCandidate);
      child.kill('SIGTERM');

      expect(await waitForChildExit(child)).toEqual({ code: 143, signal: null });
      expect(existsSync(lockFile)).toBe(true);
      expect(existsSync(ownerCandidate)).toBe(true);
      expect(existsSync(waiterCandidate)).toBe(false);
      expect(readFileSync(files.callsFile, 'utf8')).toBe('');
    } finally {
      if (child?.exitCode === null) child.kill('SIGKILL');
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('exits on TERM as the owner and releases its lock before session creation', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-tmux-term-owner-'));
    try {
      const files = installStatefulTmuxStub(tempDir);
      const sessionId = makePtySessionId('term-project', 'term-task', 'term-owner');
      const session = makeTmuxSession(sessionId, '/tmp/term-owner-label');
      const identityToken = session.name.slice(-10);
      const lockFile = path.join(tempDir, `emdash-tmux-${identityToken}.lock`);

      const child = execFile(
        '/bin/sh',
        ['-c', `exec ${buildTmuxShellLine(session, 'echo should-not-run')}`],
        { env: tmuxStubEnv(tempDir, files, { TMUX_TERM_OWNER_LOCK: lockFile }) }
      );

      expect(await waitForChildExit(child)).toEqual({ code: 143, signal: null });
      expect(existsSync(lockFile)).toBe(false);
      const calls = readFileSync(files.callsFile, 'utf8');
      expect(calls).toContain('list-sessions -F');
      expect(calls).not.toContain('new-session');
      expect(calls).not.toContain('attach-session');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('decodeLegacyTmuxSessionName', () => {
  it('round-trips a PTY session id through the legacy name format', () => {
    const sessionId = makePtySessionId('proj-1', 'task-2', 'conv-3');
    const name = makeLegacyTmuxSessionName(sessionId);
    expect(decodeLegacyTmuxSessionName(name)).toBe(sessionId);
  });

  it('returns null for a name without the emdash- prefix', () => {
    expect(decodeLegacyTmuxSessionName('other-abc')).toBeNull();
  });

  it('returns null for the bare prefix', () => {
    expect(decodeLegacyTmuxSessionName('emdash-')).toBeNull();
  });

  it('returns null when the suffix does not re-encode to the same name', () => {
    expect(decodeLegacyTmuxSessionName('emdash-not*base64url')).toBeNull();
  });
});
