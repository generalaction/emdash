import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_IN_APPS } from '@core/primitives/open-in-apps/api/open-in-apps';
import { createInstalledAppDetector, runCommand, type RunCommand } from './installed-apps';

const mocks = vi.hoisted(() => ({ currentEnv: vi.fn(async () => ({})) }));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@main/lib/userEnv', () => ({
  userShellEnvManager: { current: mocks.currentEnv },
}));

let binDir: string;

beforeEach(async () => {
  binDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-detection-bin-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(binDir, { recursive: true, force: true });
});

async function addExecutable(name: string, mode = 0o755): Promise<void> {
  const file = path.join(binDir, name);
  await writeFile(file, '#!/bin/sh\n');
  await chmod(file, mode);
}

const completed = (stdout: string) => ({ ok: true as const, stdout });
const failed = (code: string | number) => ({ ok: false as const, code });

describe('installed app detection', () => {
  it('trusts one noninteractive LaunchServices lookup for both presence and absence', async () => {
    const run = vi.fn<RunCommand>(async () => completed('{"zed":true,"vscode":false}'));
    const detector = createInstalledAppDetector({
      platform: 'darwin',
      apps: [OPEN_IN_APPS.zed, OPEN_IN_APPS.vscode, OPEN_IN_APPS.finder],
      run,
      resolveEnv: async () => ({ PATH: binDir }),
    });
    expect(await detector.check()).toEqual({
      zed: 'detected',
      vscode: 'not-detected',
      finder: 'detected',
    });
    expect(run).toHaveBeenCalledOnce();
    const [file, args] = run.mock.calls[0]!;
    expect(file).toBe('/usr/bin/osascript');
    expect(args.join(' ')).toContain('fullPathForApplication');
    expect(args.join(' ')).not.toContain('id of application');
  });

  it('finds CLIs on the launch PATH without spawning a process', async () => {
    await addExecutable('zed');
    await addExecutable('code', 0o644);
    const run = vi.fn<RunCommand>();
    const detector = createInstalledAppDetector({
      platform: 'linux',
      apps: [OPEN_IN_APPS.zed, OPEN_IN_APPS.vscode],
      run,
      resolveEnv: async () => ({ PATH: `/nonexistent:${binDir}` }),
    });
    expect(await detector.check()).toEqual({ zed: 'detected', vscode: 'not-detected' });
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves Windows CLIs through PATHEXT and a case-insensitive Path key', async () => {
    await addExecutable('code-insiders.cmd');
    const detector = createInstalledAppDetector({
      platform: 'win32',
      apps: [OPEN_IN_APPS.vscode, OPEN_IN_APPS.zed],
      run: vi.fn<RunCommand>(),
      resolveEnv: async () => ({ Path: binDir, PATHEXT: '.exe;.cmd' }),
    });
    expect(await detector.check()).toEqual({ vscode: 'detected', zed: 'not-detected' });
  });

  it('waits for the login-shell PATH before checking CLIs', async () => {
    await addExecutable('zed');
    vi.stubEnv('PATH', '/usr/bin:/bin');
    let finishCapture: () => void = () => {};
    mocks.currentEnv.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCapture = () => {
            process.env.PATH = binDir;
            resolve({});
          };
        })
    );
    const detector = createInstalledAppDetector({ platform: 'linux', apps: [OPEN_IN_APPS.zed] });
    const pending = detector.check();
    finishCapture();
    expect(await pending).toEqual({ zed: 'detected' });
  });

  it('reports a failed LaunchServices lookup as unknown but still checks CLIs', async () => {
    await addExecutable('cursor');
    const detector = createInstalledAppDetector({
      platform: 'darwin',
      apps: [OPEN_IN_APPS.zed, OPEN_IN_APPS.cursor],
      run: async () => failed('ETIMEDOUT'),
      resolveEnv: async () => ({ PATH: binDir }),
    });
    expect(await detector.check()).toEqual({ zed: 'unknown', cursor: 'detected' });
  });

  it('keeps a confirmed app after a failed lookup, and drops it after a conclusive miss', async () => {
    const run = vi.fn<RunCommand>(async () => completed('{"zed":true}'));
    const detector = createInstalledAppDetector({
      platform: 'darwin',
      apps: [OPEN_IN_APPS.zed],
      run,
      resolveEnv: async () => ({ PATH: binDir }),
    });
    expect(await detector.check()).toEqual({ zed: 'detected' });
    run.mockResolvedValue(completed('not json'));
    expect(await detector.check()).toEqual({ zed: 'detected' });
    run.mockResolvedValue(completed('{"zed":false}'));
    expect(await detector.check()).toEqual({ zed: 'not-detected' });
  });

  it('runs the same Spotlight query that launches Android Studio Canary', async () => {
    const query = OPEN_IN_APPS['android-studio-canary'].platforms.darwin!.mdfindQuery!;
    const run = vi.fn<RunCommand>(async (file, args) =>
      file === '/usr/bin/mdfind' && args[0] === query
        ? completed('/Applications/Android Studio Canary.app\n')
        : completed('{"android-studio-canary":false}')
    );
    const detector = createInstalledAppDetector({
      platform: 'darwin',
      apps: [OPEN_IN_APPS['android-studio-canary']],
      run,
      resolveEnv: async () => ({ PATH: binDir }),
    });
    expect(await detector.check()).toEqual({ 'android-studio-canary': 'detected' });
  });

  it.each([
    [completed('C:\\VS\\Common7\\IDE\\devenv.exe'), 'detected'],
    [completed(''), 'not-detected'],
    [failed('ENOENT'), 'not-detected'],
    [failed('ETIMEDOUT'), 'unknown'],
  ] as const)('maps the vswhere result %o to %s', async (result, status) => {
    const run = vi.fn<RunCommand>(async () => result);
    const detector = createInstalledAppDetector({
      platform: 'win32',
      apps: [OPEN_IN_APPS['visual-studio']],
      run,
      resolveEnv: async () => ({ Path: binDir }),
    });
    expect(await detector.check()).toEqual({ 'visual-studio': status });
    expect(run.mock.calls[0]![0]).toMatch(/vswhere\.exe$/);
  });

  it('shares concurrent scans and aborts lookups on dispose', async () => {
    let lookupSignal: AbortSignal | undefined;
    const run = vi.fn<RunCommand>(
      (_file, _args, _env, signal) =>
        new Promise((resolve) => {
          lookupSignal = signal;
          signal.addEventListener('abort', () => resolve(failed('ABORT_ERR')));
        })
    );
    const detector = createInstalledAppDetector({
      platform: 'darwin',
      apps: [OPEN_IN_APPS.zed],
      run,
      resolveEnv: async () => ({ PATH: binDir }),
    });
    const first = detector.check();
    expect(detector.check()).toBe(first);
    await vi.waitFor(() => expect(lookupSignal).toBeDefined());
    detector.dispose();
    expect(lookupSignal?.aborted).toBe(true);
    expect(await first).toEqual({ zed: 'unknown' });
    expect(run).toHaveBeenCalledOnce();
  });

  it.each(['aborted', 'timed out'] as const)(
    'kills the lookup subprocess once %s',
    async (reason) => {
      const pidFile = path.join(binDir, 'pid');
      const controller = new AbortController();
      try {
        const result = runCommand(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
            pidFile,
          ],
          process.env,
          controller.signal,
          reason === 'timed out' ? 1000 : 60_000
        );
        const pid = await vi.waitFor(async () => Number(await readFile(pidFile, 'utf8')));
        if (reason === 'aborted') controller.abort();
        expect(await result).toMatchObject({ ok: false });
        await vi.waitFor(() => {
          expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
        });
      } finally {
        controller.abort();
      }
    }
  );
});
