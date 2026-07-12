import { createHash } from 'node:crypto';
import { chmod, constants, lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { redactAll } from '@emdash/shared/logger';
import type {
  LoopBrowserActionResult,
  LoopBrowserObservation,
} from '@shared/core/loops/loop-browser-contracts';

const DEFAULT_MAX_RUNS = 100;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_EVENTS_PER_RUN = 512;
const DEFAULT_MAX_EVENT_BYTES = 96 * 1024;
const DEFAULT_MAX_SCREENSHOTS_PER_RUN = 32;
const DEFAULT_MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SCREENSHOT_BYTES_PER_RUN = 50 * 1024 * 1024;

const EVENTS_FILE = 'events.ndjson';
const SCREENSHOTS_DIR = 'screenshots';

export type LoopEvidenceRunStatus = 'passed' | 'failed' | 'cancelled' | 'correction-required';

export type LoopEvidenceScreenshot = {
  artifactId: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteLength: number;
  relativePath: string;
};

export type LoopEvidenceRunPort = {
  readonly directory: string;
  appendObservation(input: {
    actionId: string;
    actionKind: string;
    result: LoopBrowserActionResult;
  }): Promise<void>;
  appendIntermediateFailure(input: { kind: string; message: string }): Promise<void>;
  appendLeaseRotation(input: {
    previousVerificationRunId: string;
    verificationRunId: string;
    previousOrigin: string;
    allowedPreviewOrigin: string;
  }): Promise<void>;
  writeScreenshot(input: {
    artifactId: string;
    mimeType: 'image/png' | 'image/jpeg';
    data: Buffer;
  }): Promise<LoopEvidenceScreenshot>;
  /** Appends the terminal event after every previously requested write has settled. */
  finish(input: { status: LoopEvidenceRunStatus; summary: string }): Promise<void>;
};

export type LoopEvidenceStorePort = {
  beginRun(input: {
    loopId: string;
    phaseId: string;
    verificationRunId: string;
  }): Promise<LoopEvidenceRunPort>;
};

export type LoopEvidenceStoreOptions = {
  appDataPath: string;
  now?: () => Date;
  maxRuns?: number;
  maxAgeMs?: number;
  maxEventsPerRun?: number;
  maxEventBytes?: number;
  maxScreenshotsPerRun?: number;
  maxScreenshotBytes?: number;
  maxScreenshotBytesPerRun?: number;
};

type StoredEvent = {
  sequence: number;
  recordedAt: string;
  kind: string;
  data: unknown;
};

type RetentionEntry = {
  name: string;
  path: string;
  mtimeMs: number;
};

type LoopEvidenceRunOptions = {
  rootDirectory: string;
  directory: string;
  now: () => Date;
  maxEvents: number;
  maxEventBytes: number;
  maxScreenshots: number;
  maxScreenshotBytes: number;
  maxScreenshotBytesPerRun: number;
  onFinished: () => Promise<void>;
};

export class LoopEvidenceStore implements LoopEvidenceStorePort {
  private readonly appDataPath: string;
  private readonly requestedRootDirectory: string;
  private canonicalRootDirectory: string | null = null;
  private readonly now: () => Date;
  private readonly maxRuns: number;
  private readonly maxAgeMs: number;
  private readonly maxEventsPerRun: number;
  private readonly maxEventBytes: number;
  private readonly maxScreenshotsPerRun: number;
  private readonly maxScreenshotBytes: number;
  private readonly maxScreenshotBytesPerRun: number;
  private readonly activeRuns = new Set<string>();

  constructor(options: LoopEvidenceStoreOptions) {
    if (!isAbsolute(options.appDataPath)) {
      throw new TypeError('Loop evidence requires an absolute app-data path');
    }
    const appDataPath = resolve(options.appDataPath);
    this.appDataPath = appDataPath;
    this.requestedRootDirectory = join(appDataPath, 'loops', 'evidence');
    assertContainedPath(appDataPath, this.requestedRootDirectory);
    this.now = options.now ?? (() => new Date());
    this.maxRuns = positiveInteger(options.maxRuns, DEFAULT_MAX_RUNS, 'maxRuns');
    this.maxAgeMs = positiveNumber(options.maxAgeMs, DEFAULT_MAX_AGE_MS, 'maxAgeMs');
    this.maxEventsPerRun = positiveInteger(
      options.maxEventsPerRun,
      DEFAULT_MAX_EVENTS_PER_RUN,
      'maxEventsPerRun'
    );
    if (this.maxEventsPerRun < 2) {
      throw new RangeError('maxEventsPerRun must reserve one started and one terminal event');
    }
    this.maxEventBytes = positiveInteger(
      options.maxEventBytes,
      DEFAULT_MAX_EVENT_BYTES,
      'maxEventBytes'
    );
    this.maxScreenshotsPerRun = positiveInteger(
      options.maxScreenshotsPerRun,
      DEFAULT_MAX_SCREENSHOTS_PER_RUN,
      'maxScreenshotsPerRun'
    );
    this.maxScreenshotBytes = positiveInteger(
      options.maxScreenshotBytes,
      DEFAULT_MAX_SCREENSHOT_BYTES,
      'maxScreenshotBytes'
    );
    this.maxScreenshotBytesPerRun = positiveInteger(
      options.maxScreenshotBytesPerRun,
      DEFAULT_MAX_SCREENSHOT_BYTES_PER_RUN,
      'maxScreenshotBytesPerRun'
    );
  }

  get rootDirectory(): string {
    return this.canonicalRootDirectory ?? this.requestedRootDirectory;
  }

  async beginRun(input: {
    loopId: string;
    phaseId: string;
    verificationRunId: string;
  }): Promise<LoopEvidenceRunPort> {
    const loopId = boundedIdentifier(input.loopId, 'loopId');
    const phaseId = boundedIdentifier(input.phaseId, 'phaseId');
    const verificationRunId = boundedIdentifier(input.verificationRunId, 'verificationRunId');
    await this.ensureRoot();
    await this.cleanupExpired();

    const runKey = digest(`${loopId}\u0000${phaseId}\u0000${verificationRunId}`);
    const directory = join(this.rootDirectory, runKey);
    assertContainedPath(this.rootDirectory, directory);
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new Error('Loop evidence run identity already exists');
      }
      throw error;
    }
    try {
      await assertPrivateContainedDirectory(this.rootDirectory, directory);
      this.activeRuns.add(directory);
      const run = await LoopEvidenceRun.create({
        rootDirectory: this.rootDirectory,
        directory,
        now: this.now,
        maxEvents: this.maxEventsPerRun,
        maxEventBytes: this.maxEventBytes,
        maxScreenshots: this.maxScreenshotsPerRun,
        maxScreenshotBytes: this.maxScreenshotBytes,
        maxScreenshotBytesPerRun: this.maxScreenshotBytesPerRun,
        onFinished: () => {
          this.activeRuns.delete(directory);
          void this.cleanupExpired().catch(() => {});
          return Promise.resolve();
        },
      });
      await run.appendStarted({ loopId, phaseId, verificationRunId });
      return run;
    } catch (error) {
      this.activeRuns.delete(directory);
      await removeCreatedRunDirectory(this.rootDirectory, directory);
      throw error;
    }
  }

  async cleanupExpired(): Promise<void> {
    await this.ensureRoot();
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const retained: RetentionEntry[] = [];
    for (const entry of entries) {
      const entryPath = join(this.rootDirectory, entry.name);
      assertContainedPath(this.rootDirectory, entryPath);
      if (!entry.isDirectory()) {
        await rm(entryPath, { recursive: true, force: true });
        continue;
      }
      if (this.activeRuns.has(entryPath)) continue;
      await assertPrivateContainedDirectory(this.rootDirectory, entryPath);
      const details = await lstat(entryPath);
      retained.push({ name: entry.name, path: entryPath, mtimeMs: details.mtimeMs });
    }

    const expiryThreshold = this.now().getTime() - this.maxAgeMs;
    const fresh: RetentionEntry[] = [];
    for (const entry of retained) {
      if (entry.mtimeMs < expiryThreshold) {
        await rm(entry.path, { recursive: true, force: true });
      } else {
        fresh.push(entry);
      }
    }

    fresh.sort(
      (left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name)
    );
    for (const entry of fresh.slice(this.maxRuns)) {
      await rm(entry.path, { recursive: true, force: true });
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.appDataPath, { recursive: true, mode: 0o700 });
    const canonicalAppDataPath = await realpath(this.appDataPath);
    if (!sameFilesystemPath(canonicalAppDataPath, this.appDataPath)) {
      throw new Error('Loop evidence app-data path must not traverse symbolic links');
    }
    const loopsDirectory = join(canonicalAppDataPath, 'loops');
    const rootDirectory = join(loopsDirectory, 'evidence');
    await ensurePrivateDirectory(loopsDirectory);
    await ensurePrivateDirectory(rootDirectory);
    this.canonicalRootDirectory = rootDirectory;
  }
}

class LoopEvidenceRun implements LoopEvidenceRunPort {
  readonly directory: string;
  private readonly rootDirectory: string;
  private readonly eventPath: string;
  private readonly screenshotsPath: string;
  private readonly now: () => Date;
  private readonly maxEvents: number;
  private readonly maxEventBytes: number;
  private readonly maxScreenshots: number;
  private readonly maxScreenshotBytes: number;
  private readonly maxScreenshotBytesPerRun: number;
  private readonly onFinished: () => Promise<void>;
  private sequence = 0;
  private screenshotCount = 0;
  private screenshotBytes = 0;
  private finished = false;
  private operationTail: Promise<void> = Promise.resolve();

  private constructor(input: LoopEvidenceRunOptions) {
    this.rootDirectory = input.rootDirectory;
    this.directory = input.directory;
    this.eventPath = join(input.directory, EVENTS_FILE);
    this.screenshotsPath = join(input.directory, SCREENSHOTS_DIR);
    this.now = input.now;
    this.maxEvents = input.maxEvents;
    this.maxEventBytes = input.maxEventBytes;
    this.maxScreenshots = input.maxScreenshots;
    this.maxScreenshotBytes = input.maxScreenshotBytes;
    this.maxScreenshotBytesPerRun = input.maxScreenshotBytesPerRun;
    this.onFinished = input.onFinished;
  }

  static async create(input: LoopEvidenceRunOptions): Promise<LoopEvidenceRun> {
    const run = new LoopEvidenceRun(input);
    await run.assertDirectories(false);
    await ensurePrivateDirectory(run.screenshotsPath, false);
    await run.assertDirectories();
    const eventHandle = await open(
      run.eventPath,
      constants.O_APPEND |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    );
    try {
      await eventHandle.chmod(0o600);
    } finally {
      await eventHandle.close();
    }
    const screenshotUsage = await readScreenshotUsage(run.screenshotsPath);
    run.screenshotCount = screenshotUsage.count;
    run.screenshotBytes = screenshotUsage.bytes;
    return run;
  }

  appendStarted(input: {
    loopId: string;
    phaseId: string;
    verificationRunId: string;
  }): Promise<void> {
    return this.enqueue(() =>
      this.appendUnlocked('started', {
        loopId: sanitizeText(input.loopId, 256),
        phaseId: sanitizeText(input.phaseId, 256),
        verificationRunId: sanitizeText(input.verificationRunId, 256),
      })
    );
  }

  appendObservation(input: {
    actionId: string;
    actionKind: string;
    result: LoopBrowserActionResult;
  }): Promise<void> {
    return this.enqueue(() =>
      this.appendUnlocked('observation', {
        actionId: sanitizeText(input.actionId, 256),
        actionKind: sanitizeText(input.actionKind, 64),
        result: sanitizeActionResult(input.result),
      })
    );
  }

  appendIntermediateFailure(input: { kind: string; message: string }): Promise<void> {
    return this.enqueue(() =>
      this.appendUnlocked('intermediate-failure', {
        failureKind: sanitizeText(input.kind, 128),
        message: sanitizeText(input.message, 4_096),
      })
    );
  }

  appendLeaseRotation(input: {
    previousVerificationRunId: string;
    verificationRunId: string;
    previousOrigin: string;
    allowedPreviewOrigin: string;
  }): Promise<void> {
    return this.enqueue(() =>
      this.appendUnlocked('lease-rotation', {
        previousVerificationRunId: sanitizeText(input.previousVerificationRunId, 256),
        verificationRunId: sanitizeText(input.verificationRunId, 256),
        previousOrigin: sanitizeUrl(input.previousOrigin),
        allowedPreviewOrigin: sanitizeUrl(input.allowedPreviewOrigin),
      })
    );
  }

  async writeScreenshot(input: {
    artifactId: string;
    mimeType: 'image/png' | 'image/jpeg';
    data: Buffer;
  }): Promise<LoopEvidenceScreenshot> {
    return await this.enqueue(async () => {
      this.assertOpen();
      await this.assertDirectories();
      const artifactId = boundedIdentifier(input.artifactId, 'artifactId');
      if (input.mimeType !== 'image/png' && input.mimeType !== 'image/jpeg') {
        throw new TypeError('Loop evidence only accepts PNG or JPEG screenshots');
      }
      if (input.data.byteLength === 0 || input.data.byteLength > this.maxScreenshotBytes) {
        throw new RangeError('Loop evidence screenshot exceeds its bounded size');
      }
      if (this.screenshotCount >= this.maxScreenshots) {
        throw new RangeError('Loop evidence screenshot count limit was reached');
      }
      if (this.screenshotBytes + input.data.byteLength > this.maxScreenshotBytesPerRun) {
        throw new RangeError('Loop evidence screenshot byte limit was reached');
      }

      const extension = input.mimeType === 'image/png' ? 'png' : 'jpg';
      const fileName = `${digest(artifactId)}.${extension}`;
      const relativePath = join(SCREENSHOTS_DIR, fileName);
      const artifactPath = join(this.directory, relativePath);
      assertContainedPath(this.directory, artifactPath);
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      let created = false;
      try {
        handle = await open(
          artifactPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        );
        created = true;
        await handle.writeFile(input.data);
        await handle.chmod(0o600);
        await handle.close();
        handle = null;

        const artifact = {
          artifactId: sanitizeText(artifactId, 256),
          mimeType: input.mimeType,
          byteLength: input.data.byteLength,
          relativePath,
        } satisfies LoopEvidenceScreenshot;
        await this.appendUnlocked('screenshot', artifact);
        this.screenshotCount += 1;
        this.screenshotBytes += input.data.byteLength;
        return artifact;
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (created) await rm(artifactPath, { force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async finish(input: { status: LoopEvidenceRunStatus; summary: string }): Promise<void> {
    await this.enqueue(async () => {
      this.assertOpen();
      await this.appendUnlocked(
        'terminal',
        {
          status: input.status,
          summary: sanitizeText(input.summary, 16_384),
        },
        true
      );
      this.finished = true;
      await this.onFinished();
    });
  }

  private async appendUnlocked(kind: string, data: unknown, terminal = false): Promise<void> {
    this.assertOpen();
    await this.assertDirectories();
    const eventLimit = terminal ? this.maxEvents : this.maxEvents - 1;
    if (this.sequence >= eventLimit) {
      throw new RangeError('Loop evidence event limit was reached');
    }
    const event: StoredEvent = {
      sequence: this.sequence + 1,
      recordedAt: this.now().toISOString(),
      kind,
      data,
    };
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > this.maxEventBytes) {
      throw new RangeError('Loop evidence event exceeds its bounded size');
    }
    const handle = await open(
      this.eventPath,
      constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.chmod(0o600);
      await handle.writeFile(line, 'utf8');
    } finally {
      await handle.close();
    }
    this.sequence += 1;
  }

  private async assertDirectories(includeScreenshots = true): Promise<void> {
    await assertPrivateContainedDirectory(this.rootDirectory, this.directory);
    if (includeScreenshots) {
      await assertPrivateContainedDirectory(this.directory, this.screenshotsPath);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assertOpen(): void {
    if (this.finished) throw new Error('Loop evidence run is already finished');
  }
}

async function readScreenshotUsage(path: string): Promise<{ count: number; bytes: number }> {
  const entries = await readdir(path, { withFileTypes: true });
  let count = 0;
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    assertContainedPath(path, entryPath);
    const details = await lstat(entryPath);
    if (!entry.isFile() || !details.isFile() || details.isSymbolicLink()) {
      await rm(entryPath, { recursive: true, force: true });
      continue;
    }
    count += 1;
    bytes += details.size;
  }
  return { count, bytes };
}

function sanitizeActionResult(result: LoopBrowserActionResult): LoopBrowserActionResult {
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: result.error.kind,
        message: sanitizeText(result.error.message, 2_048),
      },
    };
  }
  return { ok: true, observation: sanitizeObservation(result.observation) };
}

function sanitizeObservation(observation: LoopBrowserObservation): LoopBrowserObservation {
  switch (observation.kind) {
    case 'navigation':
      return {
        kind: observation.kind,
        currentUrl: sanitizeUrl(observation.currentUrl),
        ...(observation.title ? { title: sanitizeText(observation.title, 512) } : {}),
      };
    case 'interaction':
      return { kind: observation.kind, currentUrl: sanitizeUrl(observation.currentUrl) };
    case 'accessibility-snapshot':
      return {
        kind: observation.kind,
        snapshot: sanitizeText(observation.snapshot, 65_536),
        truncated: observation.truncated,
      };
    case 'accessibility-query':
      return {
        kind: observation.kind,
        matches: observation.matches.slice(0, 50).map((match) => ({
          nodeId: sanitizeText(match.nodeId, 256),
          role: sanitizeText(match.role, 64),
          name: sanitizeText(match.name, 512),
          ...(match.value !== undefined ? { value: sanitizeText(match.value, 2_048) } : {}),
          ...(match.disabled !== undefined ? { disabled: match.disabled } : {}),
        })),
        truncated: observation.truncated || observation.matches.length > 50,
      };
    case 'screenshot':
      return {
        kind: observation.kind,
        artifact: {
          artifactId: sanitizeText(observation.artifact.artifactId, 256),
          mimeType: observation.artifact.mimeType,
          byteLength: observation.artifact.byteLength,
        },
      };
    case 'diagnostics':
      return {
        kind: observation.kind,
        entries: observation.entries.slice(0, 50).map((entry) => ({
          level: entry.level,
          source: entry.source,
          message: sanitizeText(entry.message, 2_048),
          redacted: true,
        })),
        truncated: observation.truncated || observation.entries.length > 50,
      };
  }
}

function sanitizeText(value: string, limit: number): string {
  return redactAll(stripUrlDetails(value.slice(0, limit * 4))).slice(0, limit);
}

function stripUrlDetails(value: string): string {
  return value.replace(/\b[a-z][a-z0-9+.-]*:[^\s<>"']+/giu, (candidate) => sanitizeUrl(candidate));
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[REDACTED_URL]';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2_048);
  } catch {
    return '[REDACTED_URL]';
  }
}

function boundedIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be a non-empty bounded identifier`);
  }
  return value;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return resolved;
}

function positiveNumber(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${label} must be positive`);
  }
  return resolved;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertContainedPath(parent: string, candidate: string): void {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  if (pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))) {
    return;
  }
  throw new Error('Loop evidence path escaped its app-data root');
}

async function ensurePrivateDirectory(path: string, allowExisting = true): Promise<void> {
  try {
    await mkdir(path, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (!allowExisting || !isNodeError(error) || error.code !== 'EEXIST') throw error;
  }
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('Loop evidence directory must not be a symbolic link');
  }
  const canonical = await realpath(path);
  if (!sameFilesystemPath(canonical, resolve(path))) {
    throw new Error('Loop evidence directory must not traverse symbolic links');
  }
  await chmod(path, 0o700);
}

async function assertPrivateContainedDirectory(parent: string, candidate: string): Promise<void> {
  assertContainedPath(parent, candidate);
  await assertCanonicalDirectory(parent);
  await assertCanonicalDirectory(candidate);
}

async function assertCanonicalDirectory(path: string): Promise<void> {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('Loop evidence directory must not be a symbolic link');
  }
  const canonical = await realpath(path);
  if (!sameFilesystemPath(canonical, resolve(path))) {
    throw new Error('Loop evidence directory must not traverse symbolic links');
  }
}

async function removeCreatedRunDirectory(root: string, directory: string): Promise<void> {
  assertContainedPath(root, directory);
  try {
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      await rm(directory, { force: true });
      return;
    }
    await assertPrivateContainedDirectory(root, directory);
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
  }
}

function sameFilesystemPath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
