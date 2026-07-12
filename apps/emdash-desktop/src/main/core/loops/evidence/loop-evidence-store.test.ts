import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoopEvidenceStore } from './loop-evidence-store';

describe('LoopEvidenceStore', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('keeps redacted evidence and sensitive screenshots under app data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-'));
    tempDirs.push(root);
    const appDataPath = join(root, 'app-data');
    const repositoryPath = join(root, 'repository');
    const store = new LoopEvidenceStore({ appDataPath });

    const run = await store.beginRun({
      loopId: '../loop',
      phaseId: '../../phase',
      verificationRunId: '../../../run',
    });
    await run.appendIntermediateFailure({
      kind: 'browser-action',
      message:
        'token=super-secret https://user:pass@example.test/account?token=secret#private ' +
        'file:///home/devuser/private data:text/plain,secret javascript:alert(secret) ' +
        'cookie=sessionid=intermediate-cookie-secret',
    });
    await run.appendObservation({
      actionId: 'diagnostics',
      actionKind: 'diagnostics',
      result: {
        ok: true,
        observation: {
          kind: 'diagnostics',
          entries: [
            {
              level: 'error',
              source: 'network',
              message:
                'Set-Cookie: sessionid=observed-cookie-secret; HttpOnly\n' +
                '{"cookie":"opaque-evidence-7319"}\n' +
                '{\\"set-cookie\\":\\"opaque-evidence-8427\\"}\n' +
                'Accept cookies to continue',
              redacted: true,
            },
          ],
          truncated: false,
        },
      },
    });
    const artifact = await run.writeScreenshot({
      artifactId: '../../shot',
      mimeType: 'image/png',
      data: Buffer.from('sensitive-pixels'),
    });
    await run.finish({ status: 'passed', summary: 'password=hunter2 final result' });

    expect(run.directory.startsWith(appDataPath)).toBe(true);
    expect(run.directory.startsWith(repositoryPath)).toBe(false);
    expect(artifact.relativePath).not.toContain('..');
    expect((await stat(run.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(run.directory, artifact.relativePath))).mode & 0o777).toBe(0o600);
    const events = await readFile(join(run.directory, 'events.ndjson'), 'utf8');
    expect(events).toContain('[REDACTED]');
    expect(events).not.toContain('super-secret');
    expect(events).not.toContain('hunter2');
    expect(events).not.toContain('intermediate-cookie-secret');
    expect(events).not.toContain('observed-cookie-secret');
    expect(events).not.toContain('opaque-evidence-7319');
    expect(events).not.toContain('opaque-evidence-8427');
    expect(events).toContain('Accept cookies to continue');
    expect(events).not.toContain('?token=');
    expect(events).not.toContain('#private');
    expect(events).not.toContain('file:///');
    expect(events).not.toContain('data:text');
    expect(events).not.toContain('javascript:');
    const records = events
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { sequence: number; kind: string });
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(records.map(({ kind }) => kind)).toEqual([
      'started',
      'intermediate-failure',
      'observation',
      'screenshot',
      'terminal',
    ]);
  });

  it('rejects duplicate and concurrent run authority instead of reopening append history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-authority-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({ appDataPath: join(root, 'app-data') });
    const identity = { loopId: 'loop', phaseId: 'phase', verificationRunId: 'run' };

    const attempts = await Promise.allSettled([store.beginRun(identity), store.beginRun(identity)]);

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const successful = attempts.find(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof store.beginRun>>> =>
        attempt.status === 'fulfilled'
    );
    expect(successful).toBeDefined();
    await successful!.value.finish({ status: 'failed', summary: 'first authority retained' });
    await expect(store.beginRun(identity)).rejects.toThrow(/already exists/i);
  });

  it('reserves a newly created run against concurrent retention before authority capture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-init-reservation-'));
    tempDirs.push(root);
    let initializingPath = '';
    let signalEntered!: () => void;
    let releaseInitialization!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const initializationBarrier = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      now: () => new Date('2026-07-12T05:00:00.000Z'),
      maxAgeMs: 1_000,
      testHooks: {
        afterRunDirectoryCreate: async (path) => {
          initializingPath = path;
          await utimes(path, new Date(0), new Date(0));
          signalEntered();
          await initializationBarrier;
        },
      },
    });

    const beginPromise = store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'initializing',
    });
    await entered;
    try {
      await store.cleanupExpired();
      await expect(access(initializingPath)).resolves.toBeUndefined();
    } finally {
      releaseInitialization();
    }
    const run = await beginPromise;
    await run.finish({ status: 'failed', summary: 'initialization remained authoritative' });
  });

  it('serializes concurrent appends and reserves terminal capacity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-events-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      maxEventsPerRun: 4,
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });

    await Promise.all([
      run.appendIntermediateFailure({ kind: 'first', message: 'first failure' }),
      run.appendIntermediateFailure({ kind: 'second', message: 'second failure' }),
    ]);
    await expect(
      run.appendIntermediateFailure({ kind: 'overflow', message: 'must not consume terminal' })
    ).rejects.toThrow(/event limit/i);
    await run.finish({ status: 'failed', summary: 'terminal remains durable' });

    const records = (await readFile(join(run.directory, 'events.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { sequence: number; kind: string });
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(records.at(-1)?.kind).toBe('terminal');
  });

  it('removes a screenshot if its append-only metadata cannot be committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-atomic-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      maxEventsPerRun: 2,
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });

    await expect(
      run.writeScreenshot({
        artifactId: 'shot',
        mimeType: 'image/png',
        data: Buffer.from('pixels'),
      })
    ).rejects.toThrow(/event limit/i);
    expect(await readdir(join(run.directory, 'screenshots'))).toEqual([]);
    await run.finish({ status: 'failed', summary: 'metadata write failed' });
  });

  it('keeps an unfinished run authoritative when terminal persistence fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-finish-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      maxEventBytes: 512,
    });
    const identity = { loopId: 'loop', phaseId: 'phase', verificationRunId: 'run' };
    const run = await store.beginRun(identity);

    await expect(run.finish({ status: 'failed', summary: 'x'.repeat(4_000) })).rejects.toThrow(
      /event exceeds/i
    );
    await expect(store.beginRun(identity)).rejects.toThrow(/already exists/i);
    await run.finish({ status: 'failed', summary: 'bounded terminal' });
  });

  it('releases an abandoned failed-finalization run to bounded retention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-abandon-'));
    tempDirs.push(root);
    let now = new Date('2026-07-12T05:00:00.000Z');
    const appDataPath = join(root, 'app-data');
    const store = new LoopEvidenceStore({
      appDataPath,
      now: () => now,
      maxAgeMs: 1_000,
      maxEventBytes: 512,
    });
    const identity = { loopId: 'loop', phaseId: 'phase', verificationRunId: 'abandoned' };
    const run = await store.beginRun(identity);

    await expect(run.finish({ status: 'failed', summary: 'x'.repeat(4_000) })).rejects.toThrow(
      /event exceeds/i
    );
    await run.abandon();
    await expect(
      run.appendIntermediateFailure({ kind: 'late', message: 'must stay closed' })
    ).rejects.toThrow(/finished/i);
    await expect(store.beginRun(identity)).rejects.toThrow(/already exists/i);
    await store.cleanupExpired();
    await utimes(run.directory, now, now);
    now = new Date(now.getTime() + 2_000);
    await store.cleanupExpired();
    await expect(access(run.directory)).rejects.toThrow();
  });

  it('cleans a failed initialization so the same authority can retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-init-'));
    tempDirs.push(root);
    const appDataPath = join(root, 'app-data');
    const identity = { loopId: 'loop', phaseId: 'phase', verificationRunId: 'run' };
    const tooSmall = new LoopEvidenceStore({ appDataPath, maxEventBytes: 8 });

    await expect(tooSmall.beginRun(identity)).rejects.toThrow(/event exceeds/i);

    const retry = new LoopEvidenceStore({ appDataPath });
    const run = await retry.beginRun(identity);
    await run.finish({ status: 'failed', summary: 'retry succeeded' });
  });

  it('rejects app-data symlinks and pre-created run or screenshot symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-symlink-'));
    tempDirs.push(root);
    const repository = join(root, 'repository');
    const linkedAppData = join(root, 'linked-app-data');
    await mkdir(repository);
    await symlink(repository, linkedAppData, 'dir');
    const linkedStore = new LoopEvidenceStore({ appDataPath: linkedAppData });
    await expect(
      linkedStore.beginRun({ loopId: 'loop', phaseId: 'phase', verificationRunId: 'run' })
    ).rejects.toThrow(/symbolic links/i);

    const appDataPath = join(root, 'app-data');
    const store = new LoopEvidenceStore({ appDataPath });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'safe',
    });
    const victim = join(root, 'victim');
    await writeFile(victim, 'untouched');
    const artifactId = 'attacker-known-artifact';
    const artifactName = `${createHash('sha256').update(artifactId).digest('hex')}.png`;
    await symlink(victim, join(run.directory, 'screenshots', artifactName));

    await expect(
      run.writeScreenshot({ artifactId, mimeType: 'image/png', data: Buffer.from('overwrite') })
    ).rejects.toThrow();
    expect(await readFile(victim, 'utf8')).toBe('untouched');
    await run.finish({ status: 'failed', summary: 'symlink rejected' });
  });

  it('enforces screenshot count, per-file, and aggregate byte limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-limits-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      maxScreenshotsPerRun: 2,
      maxScreenshotBytes: 4,
      maxScreenshotBytesPerRun: 6,
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });

    await expect(
      run.writeScreenshot({ artifactId: 'large', mimeType: 'image/png', data: Buffer.alloc(5) })
    ).rejects.toThrow(/bounded size/i);
    await run.writeScreenshot({ artifactId: 'one', mimeType: 'image/png', data: Buffer.alloc(4) });
    await expect(
      run.writeScreenshot({ artifactId: 'aggregate', mimeType: 'image/png', data: Buffer.alloc(3) })
    ).rejects.toThrow(/byte limit/i);
    await run.writeScreenshot({ artifactId: 'two', mimeType: 'image/jpeg', data: Buffer.alloc(2) });
    await expect(
      run.writeScreenshot({ artifactId: 'count', mimeType: 'image/png', data: Buffer.alloc(1) })
    ).rejects.toThrow(/count limit/i);
    await run.finish({ status: 'passed', summary: 'limits enforced' });
  });

  it('expires old evidence and deterministically retains only the newest bounded runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-retention-'));
    tempDirs.push(root);
    let now = new Date('2026-07-12T05:00:00.000Z');
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      now: () => now,
      maxRuns: 2,
      maxAgeMs: 60_000,
    });
    const first = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: '1',
    });
    await first.finish({ status: 'failed', summary: 'first' });
    await utimes(
      first.directory,
      new Date(now.getTime() - 20_000),
      new Date(now.getTime() - 20_000)
    );
    const second = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: '2',
    });
    await second.finish({ status: 'failed', summary: 'second' });
    await utimes(
      second.directory,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 10_000)
    );
    const third = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: '3',
    });
    await third.finish({ status: 'passed', summary: 'third' });
    await utimes(third.directory, now, now);
    await store.cleanupExpired();

    await expect(access(first.directory)).rejects.toThrow();
    await expect(access(second.directory)).resolves.toBeUndefined();
    await expect(access(third.directory)).resolves.toBeUndefined();

    now = new Date(now.getTime() + 120_000);
    await store.cleanupExpired();
    await expect(access(second.directory)).rejects.toThrow();
    await expect(access(third.directory)).rejects.toThrow();
  });

  it('does not follow unexpected retention symlinks outside the evidence root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-cleanup-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({ appDataPath: join(root, 'app-data') });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });
    await run.finish({ status: 'passed', summary: 'complete' });
    const victim = join(root, 'retention-victim');
    await writeFile(victim, 'retain me');
    const link = join(store.rootDirectory, 'unexpected-link');
    await symlink(victim, link);

    await store.cleanupExpired();

    await expect(access(link)).rejects.toThrow();
    expect(await readFile(victim, 'utf8')).toBe('retain me');
  });

  it('rejects a swapped run directory before appending events or screenshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-run-swap-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({ appDataPath: join(root, 'app-data') });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });
    const originalDirectory = `${run.directory}-original`;
    const outside = join(root, 'outside');
    await mkdir(outside);
    await rename(run.directory, originalDirectory);
    await symlink(outside, run.directory, 'dir');

    await expect(
      run.appendIntermediateFailure({ kind: 'swap', message: 'must stay inside app data' })
    ).rejects.toThrow(/symbolic|traverse/i);
    await expect(
      run.writeScreenshot({
        artifactId: 'swapped-shot',
        mimeType: 'image/png',
        data: Buffer.from('sensitive pixels'),
      })
    ).rejects.toThrow(/symbolic|traverse/i);
    expect(await readdir(outside)).toEqual([]);

    await rm(run.directory, { force: true });
    await rename(originalDirectory, run.directory);
    await run.finish({ status: 'failed', summary: 'swap rejected' });
  });

  it('rejects an event path swapped after open before writing through the handle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-event-open-swap-'));
    tempDirs.push(root);
    let armed = false;
    let displacedPath = '';
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      testHooks: {
        afterFileOpen: async ({ kind, operation, path }) => {
          if (!armed || kind !== 'events' || operation !== 'append') return;
          armed = false;
          displacedPath = `${path}.opened`;
          await rename(path, displacedPath);
          await writeFile(path, 'attacker replacement\n');
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'event-open-swap',
    });

    armed = true;
    await expect(
      run.appendIntermediateFailure({ kind: 'swap', message: 'sensitive event' })
    ).rejects.toThrow(/identity/i);
    expect(await readFile(displacedPath, 'utf8')).not.toContain('sensitive event');
    expect(await readFile(join(run.directory, 'events.ndjson'), 'utf8')).toBe(
      'attacker replacement\n'
    );

    await unlink(join(run.directory, 'events.ndjson'));
    await rename(displacedPath, join(run.directory, 'events.ndjson'));
    await run.finish({ status: 'failed', summary: 'event swap rejected' });
  });

  it('poisons the event stream when its path changes after a committed write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-event-post-write-swap-'));
    tempDirs.push(root);
    let armed = false;
    let eventPath = '';
    let displacedPath = '';
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      testHooks: {
        afterFileWrite: async ({ kind, operation, path }) => {
          if (!armed || kind !== 'events' || operation !== 'append') return;
          armed = false;
          eventPath = path;
          displacedPath = `${path}.committed`;
          await rename(path, displacedPath);
          await writeFile(path, 'attacker replacement\n');
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'event-post-write-swap',
    });

    armed = true;
    await expect(
      run.appendIntermediateFailure({ kind: 'committed', message: 'one durable event' })
    ).rejects.toThrow(/identity/i);
    await expect(run.finish({ status: 'failed', summary: 'must not duplicate' })).rejects.toThrow(
      /uncertain append/i
    );
    const records = (await readFile(displacedPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { sequence: number });
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(await readFile(eventPath, 'utf8')).toBe('attacker replacement\n');
  });

  it('poisons the event stream when close fails after a committed write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-event-close-failure-'));
    tempDirs.push(root);
    let armed = false;
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      testHooks: {
        closeFile: async ({ kind, operation, handle }) => {
          await handle.close();
          if (armed && kind === 'events' && operation === 'append') {
            armed = false;
            throw new Error('event close acknowledgement failed');
          }
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'event-close-failure',
    });

    armed = true;
    await expect(
      run.appendIntermediateFailure({ kind: 'committed', message: 'one durable event' })
    ).rejects.toThrow(/close acknowledgement failed/i);
    await expect(run.finish({ status: 'failed', summary: 'must not duplicate' })).rejects.toThrow(
      /uncertain append/i
    );
    const records = (await readFile(join(run.directory, 'events.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { sequence: number });
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it('rejects a screenshot path swapped after open without writing or unlinking the replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-shot-open-swap-'));
    tempDirs.push(root);
    let armed = false;
    let artifactPath = '';
    let displacedPath = '';
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      testHooks: {
        afterFileOpen: async ({ kind, path }) => {
          if (!armed || kind !== 'screenshot') return;
          armed = false;
          artifactPath = path;
          displacedPath = `${path}.opened`;
          await rename(path, displacedPath);
          await writeFile(path, 'attacker replacement');
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'shot-open-swap',
    });

    armed = true;
    await expect(
      run.writeScreenshot({
        artifactId: 'shot',
        mimeType: 'image/png',
        data: Buffer.from('sensitive pixels'),
      })
    ).rejects.toThrow(/identity/i);
    expect((await readFile(displacedPath)).byteLength).toBe(0);
    expect(await readFile(artifactPath, 'utf8')).toBe('attacker replacement');

    await unlink(artifactPath);
    await unlink(displacedPath);
    await run.finish({ status: 'failed', summary: 'screenshot swap rejected' });
  });

  it('rejects a screenshot parent swapped after validation and before leaf open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-shot-parent-swap-'));
    tempDirs.push(root);
    let armed = false;
    let screenshotsPath = '';
    let originalScreenshotsPath = '';
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      testHooks: {
        beforeFileOpen: async ({ kind, path }) => {
          if (!armed || kind !== 'screenshot') return;
          armed = false;
          screenshotsPath = dirname(path);
          originalScreenshotsPath = `${screenshotsPath}-original`;
          await rename(screenshotsPath, originalScreenshotsPath);
          await mkdir(screenshotsPath, { mode: 0o700 });
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'shot-parent-swap',
    });

    armed = true;
    await expect(
      run.writeScreenshot({
        artifactId: 'shot',
        mimeType: 'image/png',
        data: Buffer.from('sensitive pixels'),
      })
    ).rejects.toThrow(/identity/i);
    const replacementFiles = await readdir(screenshotsPath);
    expect(replacementFiles).toHaveLength(1);
    expect((await readFile(join(screenshotsPath, replacementFiles[0]!))).byteLength).toBe(0);
    expect(await readdir(originalScreenshotsPath)).toEqual([]);

    await rm(screenshotsPath, { recursive: true, force: true });
    await rename(originalScreenshotsPath, screenshotsPath);
    await run.finish({ status: 'failed', summary: 'parent swap rejected' });
  });

  it('rejects a swapped evidence root without writing through it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-root-swap-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({ appDataPath: join(root, 'app-data') });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });
    await run.finish({ status: 'passed', summary: 'complete' });
    const originalRoot = `${store.rootDirectory}-original`;
    const outside = join(root, 'outside');
    await mkdir(outside);
    await rename(store.rootDirectory, originalRoot);
    await symlink(outside, store.rootDirectory, 'dir');

    await expect(store.cleanupExpired()).rejects.toThrow(/symbolic|traverse/i);
    expect(await readdir(outside)).toEqual([]);

    await rm(store.rootDirectory, { force: true });
    await rename(originalRoot, store.rootDirectory);
  });

  it('refuses a run-directory swap immediately before retention removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-remove-swap-'));
    tempDirs.push(root);
    let now = new Date('2026-07-12T05:00:00.000Z');
    let runPath = '';
    let originalRunPath = '';
    let swapped = false;
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      now: () => now,
      maxAgeMs: 1_000,
      testHooks: {
        beforeRemove: async ({ kind, path }) => {
          if (swapped || kind !== 'directory' || path !== runPath) return;
          swapped = true;
          originalRunPath = `${path}-original`;
          await rename(path, originalRunPath);
          await mkdir(path, { mode: 0o700 });
          await writeFile(join(path, 'victim.txt'), 'must survive');
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'remove-swap',
    });
    runPath = run.directory;
    await run.finish({ status: 'failed', summary: 'ready for retention' });
    await store.cleanupExpired();
    await utimes(runPath, now, now);
    now = new Date(now.getTime() + 2_000);

    await expect(store.cleanupExpired()).rejects.toThrow(/identity/i);
    expect(await readFile(join(runPath, 'victim.txt'), 'utf8')).toBe('must survive');

    await rm(runPath, { recursive: true, force: true });
    await rename(originalRunPath, runPath);
    await utimes(runPath, new Date(now.getTime() - 2_000), new Date(now.getTime() - 2_000));
    await store.cleanupExpired();
    await expect(access(runPath)).rejects.toThrow();
  });

  it('aggregates screenshot artifact removal failure with the metadata failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-shot-remove-failure-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      maxEventsPerRun: 2,
      testHooks: {
        removeFile: async (path) => {
          if (path.endsWith('.png')) throw new Error('artifact unlink blocked');
          await unlink(path);
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'shot-remove-failure',
    });

    await expect(
      run.writeScreenshot({
        artifactId: 'shot',
        mimeType: 'image/png',
        data: Buffer.from('pixels'),
      })
    ).rejects.toThrow(/event limit.*artifact unlink blocked/is);
    expect(await readdir(join(run.directory, 'screenshots'))).toHaveLength(1);
  });

  it('aggregates screenshot close and artifact removal failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-shot-close-failure-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({
      appDataPath: join(root, 'app-data'),
      testHooks: {
        closeFile: async ({ kind, handle }) => {
          await handle.close();
          if (kind === 'screenshot') throw new Error('artifact close reported failure');
        },
        removeFile: async (path) => {
          if (path.endsWith('.png')) throw new Error('artifact unlink also failed');
          await unlink(path);
        },
      },
    });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'shot-close-failure',
    });

    await expect(
      run.writeScreenshot({
        artifactId: 'shot',
        mimeType: 'image/png',
        data: Buffer.from('pixels'),
      })
    ).rejects.toThrow(/artifact close reported failure.*artifact unlink also failed/is);
    expect(await readdir(join(run.directory, 'screenshots'))).toHaveLength(1);
  });

  it('aggregates failed-initialization run removal instead of swallowing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-init-remove-failure-'));
    tempDirs.push(root);
    const appDataPath = join(root, 'app-data');
    const store = new LoopEvidenceStore({
      appDataPath,
      maxEventBytes: 8,
      testHooks: {
        removeDirectory: async (path) => {
          if (!path.endsWith('screenshots')) throw new Error('run rmdir blocked');
          await rmdir(path);
        },
      },
    });

    await expect(
      store.beginRun({ loopId: 'loop', phaseId: 'phase', verificationRunId: 'init-rmdir' })
    ).rejects.toThrow(/event exceeds.*run rmdir blocked/is);
    const runs = await readdir(join(appDataPath, 'loops', 'evidence'));
    expect(runs).toHaveLength(1);
  });

  it('surfaces ENOENT from a file removal after run cleanup has begun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-init-unlink-race-'));
    tempDirs.push(root);
    const appDataPath = join(root, 'app-data');
    const store = new LoopEvidenceStore({
      appDataPath,
      maxEventBytes: 8,
      testHooks: {
        removeFile: async () => {
          throw Object.assign(new Error('event disappeared during unlink'), { code: 'ENOENT' });
        },
      },
    });

    await expect(
      store.beginRun({ loopId: 'loop', phaseId: 'phase', verificationRunId: 'unlink-race' })
    ).rejects.toThrow(/event exceeds.*event disappeared during unlink/is);
    const [runName] = await readdir(join(appDataPath, 'loops', 'evidence'));
    expect(await readdir(join(appDataPath, 'loops', 'evidence', runName!))).toContain(
      'events.ndjson'
    );
  });

  it('keeps a durable terminal authoritative when best-effort retention cleanup fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-loop-evidence-retention-failure-'));
    tempDirs.push(root);
    const store = new LoopEvidenceStore({ appDataPath: join(root, 'app-data') });
    const run = await store.beginRun({
      loopId: 'loop',
      phaseId: 'phase',
      verificationRunId: 'run',
    });
    const cleanup = vi.spyOn(store, 'cleanupExpired').mockRejectedValueOnce(new Error('busy'));

    await expect(
      run.finish({ status: 'passed', summary: 'durable pass' })
    ).resolves.toBeUndefined();

    const records = (await readFile(join(run.directory, 'events.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; data: { status?: string } });
    expect(records.at(-1)).toMatchObject({ kind: 'terminal', data: { status: 'passed' } });
    cleanup.mockRestore();
    await expect(store.cleanupExpired()).resolves.toBeUndefined();
  });
});
