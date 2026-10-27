import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PtySession, buildTmuxShellLine } from '@emdash/core/services/pty/api';
import { Terminal } from '@xterm/xterm';
import { spawn } from 'node-pty';
import { describe, expect, it } from 'vitest';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';

const exec = promisify(execFile);
const hasTmux = process.platform !== 'win32' && spawnSync('tmux', ['-V']).status === 0;

describe.skipIf(!hasTmux)('tmux with real xterm parsing', () => {
  it('preserves negotiation and pane input when renderer output arrives after the probe timeout', async () => {
    const baseline = await attach(false);
    let delayed: Awaited<ReturnType<typeof attach>> | undefined;
    try {
      await expect.poll(() => baseline.rendererReplies.length).toBeGreaterThanOrEqual(2);
      const baselineFeatures = await baseline.features();
      delayed = await attach(true);
      const current = delayed;
      // tmux 3.5a's startup query timeout is five seconds. The host must reply
      // before that even when the renderer has not received a single byte.
      await expect.poll(() => current.hostReplies).toEqual(['\x1b[?1;2c', '\x1b[>0;276;0c']);
      expect(current.rendererReplies).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      current.release();
      await expect.poll(() => current.screen()).toContain('PROBE>');
      expect(await current.features()).toBe(baselineFeatures);
      expect(await current.capture()).not.toMatch(/1;2c|0;276;0c/);
      expect(current.rendererReplies).not.toContain('\x1b[?1;2c');
      expect(current.rendererReplies).not.toContain('\x1b[>0;276;0c');

      current.session.write("printf 'USER_%s\\n' INPUT_OK\r");
      await expect.poll(() => current.capture()).toContain('USER_INPUT_OK');

      // A pane can explicitly query the outer terminal through tmux passthrough.
      // The reply must reach the pane; dropping DA-shaped stdin breaks this.
      const supportsPassthrough = await current
        .command(['show-options', '-g', 'allow-passthrough'])
        .then(
          () => true,
          () => false
        );
      if (supportsPassthrough) {
        await current.command(['set-option', '-t', '=probe:', 'allow-passthrough', 'on']);
        current.session.write(
          'printf \'\\033Ptmux;\\033\\033[c\\033\\\\\'; IFS= read -rs -n 7 -t 2 reply; printf \'PASSTHROUGH:%s\\n\' "$(printf %s "$reply" | od -An -tx1)"\r'
        );
        await expect
          .poll(() => current.capture(), { timeout: 4_000 })
          .toMatch(/PASSTHROUGH:\s*1b\s+5b\s+3f\s+31\s+3b\s+32\s+63/);
      }

      const repliesBeforeReplay = current.rendererReplies.length;
      current.sink.reset(current.session.output.snapshot().data);
      current.sink.append('REPLAY_FINISHED');
      await expect.poll(() => current.screen()).toContain('REPLAY_FINISHED');
      expect(current.rendererReplies).toHaveLength(repliesBeforeReplay);
    } finally {
      await delayed?.dispose();
      await baseline.dispose();
    }
  }, 20_000);
});

async function attach(answerOnHost: boolean) {
  const directory = await mkdtemp('/tmp/emdash-probe-');
  const env = {
    ...process.env,
    TMUX: '',
    TMUX_TMPDIR: directory,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    SHELL: '/bin/bash',
    PS1: 'PROBE> ',
  };
  const command = async (args: string[]) =>
    (await exec('tmux', args, { env, cwd: directory })).stdout.trim();
  // Pass argv directly: a bash shell-command wrapper discards the inherited PS1.
  await command([
    '-f',
    '/dev/null',
    'new-session',
    '-d',
    '-s',
    'probe',
    '/bin/bash',
    '--noprofile',
    '--norc',
  ]);
  const terminal = new Terminal({ cols: 100, rows: 24 });
  const sink = createXtermLogSink(terminal);
  const rendererReplies: string[] = [];
  const hostReplies: string[] = [];
  const held: string[] = [];
  let holding = answerOnHost;
  const proc = spawn('/bin/sh', ['-c', buildTmuxShellLine('probe', 'exit 99')], {
    name: 'xterm-256color',
    cols: 100,
    rows: 24,
    cwd: directory,
    env,
  });
  const session = new PtySession(
    'probe',
    {
      invocation: { kind: 'argv', executable: '/bin/sh', argv: [] },
      cwd: directory,
      env: {},
      cols: 100,
      rows: 24,
    },
    {
      write: (data) => {
        hostReplies.push(data);
        proc.write(data);
      },
      resize: (cols, rows) => proc.resize(cols, rows),
      kill: () => proc.kill(),
      onData: (handler) => {
        proc.onData(handler);
      },
      onExit: (handler) => {
        proc.onExit(({ exitCode }) => handler({ exitCode, signal: null }));
      },
    },
    {
      tmux: answerOnHost,
      onData: (chunk) => {
        if (holding) held.push(chunk);
        else sink.append(chunk);
      },
    }
  );
  terminal.onData((data) => {
    rendererReplies.push(data);
    proc.write(data);
  });
  return {
    session,
    sink,
    rendererReplies,
    hostReplies,
    command,
    release() {
      holding = false;
      for (const chunk of held.splice(0)) sink.append(chunk);
    },
    screen: () =>
      Array.from(
        { length: terminal.buffer.active.length },
        (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? ''
      ).join('\n'),
    capture: () => command(['capture-pane', '-p', '-t', '=probe:']),
    features: () => command(['list-clients', '-F', '#{client_termfeatures}']),
    async dispose() {
      await command(['kill-server']).catch(() => {});
      session.dispose();
      terminal.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
