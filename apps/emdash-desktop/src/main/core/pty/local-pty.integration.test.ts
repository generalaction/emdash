import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnLocalPty } from './local-pty';
import type { PtyExitInfo } from './pty';

const tempDirs: string[] = [];

async function tempCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'emdash-local-pty-'));
  tempDirs.push(dir);
  return dir;
}

function waitForExit(
  register: (handler: (info: PtyExitInfo) => void) => void
): Promise<PtyExitInfo> {
  return new Promise((resolve) => register(resolve));
}

function waitForData(
  register: (handler: (data: string) => void) => void,
  pattern: RegExp
): Promise<string> {
  return new Promise((resolve) => {
    let buffer = '';
    register((data) => {
      buffer += data;
      if (pattern.test(buffer)) resolve(buffer);
    });
  });
}

describe('spawnLocalPty integration', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('runs a real local PTY process, streams output, resizes, and reports exit', async () => {
    const cwd = await tempCwd();
    const pty = spawnLocalPty({
      id: 'local-integration',
      command: process.execPath,
      args: [
        '-e',
        'setTimeout(() => { process.stdout.write(`ready ${process.cwd()}\\n`); process.exit(7); }, 25);',
      ],
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    const data = await waitForData((handler) => pty.onData(handler), /ready/);
    pty.resize(120, 50);
    const exit = await waitForExit((handler) => pty.onExit(handler));

    expect(data).toContain('ready');
    expect(data).toContain(cwd);
    expect(exit.exitCode).toBe(7);
  });

  // Fullscreen TUI regression (ENG: mouse/scroll dead in opencode/claude/amp on
  // Windows): the in-box Windows 10 ConPTY swallows mouse-mode and alt-screen
  // DECSETs instead of passing them to the attached terminal, so xterm.js never
  // enters mouse-tracking mode. With node-pty's bundled ConPTY
  // (useConptyDll, see conpty-dll.ts) the sequences must arrive verbatim.
  it.runIf(process.platform === 'win32')(
    'passes mouse-mode DECSETs through to the terminal on Windows',
    async () => {
      const pty = spawnLocalPty({
        id: 'local-mouse-decset-integration',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("\\x1b[?1049h\\x1b[?1002h\\x1b[?1006hready\\n"); setTimeout(() => process.exit(0), 200);',
        ],
        cwd: await tempCwd(),
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        cols: 80,
        rows: 24,
      });

      const exitPromise = waitForExit((handler) => pty.onExit(handler));
      const data = await waitForData((handler) => pty.onData(handler), /ready/);
      await exitPromise;

      expect(data).toContain('\x1b[?1002h');
      expect(data).toContain('\x1b[?1006h');
      expect(data).toContain('\x1b[?1049h');
    }
  );

  it('can kill a real long-running local PTY process', async () => {
    const pty = spawnLocalPty({
      id: 'local-kill-integration',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      cwd: await tempCwd(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    const exitPromise = waitForExit((handler) => pty.onExit(handler));
    pty.kill();
    const exit = await exitPromise;

    expect(exit.exitCode ?? exit.signal).toBeDefined();
  });
});
