import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        'file:///home/devuser/private data:text/plain,secret javascript:alert(secret)',
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
    expect(events).not.toContain('?token=');
    expect(events).not.toContain('#private');
    expect(events).not.toContain('file:///');
    expect(events).not.toContain('data:text');
    expect(events).not.toContain('javascript:');
    const records = events
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { sequence: number; kind: string });
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(records.map(({ kind }) => kind)).toEqual([
      'started',
      'intermediate-failure',
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
