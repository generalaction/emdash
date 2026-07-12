import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { constants, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
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
const cookieAssignmentPattern =
  /\b(?:cookies?|set[_ -]?cookie|session[_ -]?(?:cookie|id)|sessionid)\b[\\'"\s]*[:=][\s\S]*/giu;

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
  /** Releases an unrecoverable unfinished run so bounded retention can remove it. */
  abandon(): Promise<void>;
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
  /** @internal Narrow seams for deterministic filesystem race and cleanup-failure tests. */
  testHooks?: LoopEvidenceStoreTestHooks;
};

export type LoopEvidenceStoreTestHooks = {
  afterRunDirectoryCreate?: (path: string) => Promise<void> | void;
  beforeFileOpen?: (input: EvidenceFileHookInput) => Promise<void> | void;
  afterFileOpen?: (input: EvidenceFileHookInput) => Promise<void> | void;
  afterFileWrite?: (input: EvidenceFileHookInput) => Promise<void> | void;
  closeFile?: (input: EvidenceCloseHookInput) => Promise<void>;
  beforeRemove?: (input: EvidenceRemoveHookInput) => Promise<void> | void;
  removeFile?: (path: string) => Promise<void>;
  removeDirectory?: (path: string) => Promise<void>;
};

type EvidenceFileHookInput = {
  kind: 'events' | 'screenshot';
  operation: 'create' | 'append';
  path: string;
};

type EvidenceRemoveHookInput = {
  kind: 'file' | 'directory';
  path: string;
};

type EvidenceCloseHookInput = EvidenceFileHookInput & { handle: FileHandle };

type FilesystemIdentity = {
  dev: bigint;
  ino: bigint;
};

type DirectoryAuthority = {
  path: string;
  canonicalPath: string;
  identity: FilesystemIdentity;
  requirePrivate: boolean;
};

type EvidenceFilesystem = {
  afterRunDirectoryCreate: (path: string) => Promise<void>;
  beforeFileOpen: (input: EvidenceFileHookInput) => Promise<void>;
  afterFileOpen: (input: EvidenceFileHookInput) => Promise<void>;
  afterFileWrite: (input: EvidenceFileHookInput) => Promise<void>;
  closeFile: (input: EvidenceCloseHookInput) => Promise<void>;
  beforeRemove: (input: EvidenceRemoveHookInput) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  removeDirectory: (path: string) => Promise<void>;
};

type StoredEvent = {
  sequence: number;
  recordedAt: string;
  kind: string;
  data: unknown;
};

type RetentionEntry = {
  name: string;
  authority: DirectoryAuthority;
  mtimeMs: number;
};

type LoopEvidenceRunOptions = {
  rootAuthority: DirectoryAuthority;
  runAuthority: DirectoryAuthority;
  filesystem: EvidenceFilesystem;
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
  private rootAuthority: DirectoryAuthority | null = null;
  private readonly now: () => Date;
  private readonly maxRuns: number;
  private readonly maxAgeMs: number;
  private readonly maxEventsPerRun: number;
  private readonly maxEventBytes: number;
  private readonly maxScreenshotsPerRun: number;
  private readonly maxScreenshotBytes: number;
  private readonly maxScreenshotBytesPerRun: number;
  private readonly filesystem: EvidenceFilesystem;
  private readonly activeRuns = new Map<string, number>();
  private cleanupTail: Promise<void> = Promise.resolve();

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
    this.filesystem = createEvidenceFilesystem(options.testHooks);
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
    const rootAuthority = this.requireRootAuthority();
    this.reserveRun(directory);
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
      await this.filesystem.afterRunDirectoryCreate(directory);
    } catch (error) {
      this.releaseRun(directory);
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new Error('Loop evidence run identity already exists');
      }
      throw error;
    }
    let runAuthority: DirectoryAuthority | null = null;
    try {
      runAuthority = await captureDirectoryAuthority(directory, rootAuthority);
      const run = await LoopEvidenceRun.create({
        rootAuthority,
        runAuthority,
        filesystem: this.filesystem,
        now: this.now,
        maxEvents: this.maxEventsPerRun,
        maxEventBytes: this.maxEventBytes,
        maxScreenshots: this.maxScreenshotsPerRun,
        maxScreenshotBytes: this.maxScreenshotBytes,
        maxScreenshotBytesPerRun: this.maxScreenshotBytesPerRun,
        onFinished: () => {
          this.releaseRun(directory);
          void this.cleanupExpired().catch(() => {});
          return Promise.resolve();
        },
      });
      await run.appendStarted({ loopId, phaseId, verificationRunId });
      return run;
    } catch (error) {
      let cleanupError: unknown = null;
      if (runAuthority) {
        try {
          await removeKnownRunDirectory(rootAuthority, runAuthority, this.filesystem);
        } catch (caughtCleanupError) {
          cleanupError = caughtCleanupError;
        }
      }
      this.releaseRun(directory);
      if (cleanupError !== null) {
        throw aggregateCleanupFailure(
          error,
          [cleanupError],
          'Loop evidence initialization cleanup failed'
        );
      }
      throw error;
    }
  }

  cleanupExpired(): Promise<void> {
    const result = this.cleanupTail.then(
      () => this.cleanupExpiredUnlocked(),
      () => this.cleanupExpiredUnlocked()
    );
    this.cleanupTail = result.catch(() => undefined);
    return result;
  }

  private async cleanupExpiredUnlocked(): Promise<void> {
    await this.ensureRoot();
    const rootAuthority = this.requireRootAuthority();
    await assertDirectoryAuthority(rootAuthority);
    const entries = await readdir(rootAuthority.path, { withFileTypes: true });
    await assertDirectoryAuthority(rootAuthority);
    const retained: RetentionEntry[] = [];
    for (const entry of entries) {
      const entryPath = join(rootAuthority.path, entry.name);
      assertContainedPath(rootAuthority.path, entryPath);
      if (!entry.isDirectory()) {
        await removeVerifiedFile(rootAuthority, entryPath, this.filesystem, undefined, true, true);
        continue;
      }
      if (this.activeRuns.has(entryPath)) continue;
      const authority = await captureDirectoryAuthority(entryPath, rootAuthority);
      const details = await lstat(entryPath, { bigint: true });
      assertSameIdentity(authority.identity, identityFromStats(details), entryPath);
      retained.push({ name: entry.name, authority, mtimeMs: Number(details.mtimeMs) });
    }

    const expiryThreshold = this.now().getTime() - this.maxAgeMs;
    const fresh: RetentionEntry[] = [];
    for (const entry of retained) {
      if (entry.mtimeMs < expiryThreshold) {
        await removeKnownRunDirectory(rootAuthority, entry.authority, this.filesystem);
      } else {
        fresh.push(entry);
      }
    }

    fresh.sort(
      (left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name)
    );
    for (const entry of fresh.slice(this.maxRuns)) {
      await removeKnownRunDirectory(rootAuthority, entry.authority, this.filesystem);
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.appDataPath, { recursive: true, mode: 0o700 });
    const appDataAuthority = await captureDirectoryAuthority(this.appDataPath, undefined, false);
    const loopsDirectory = join(appDataAuthority.canonicalPath, 'loops');
    const rootDirectory = join(loopsDirectory, 'evidence');
    const loopsAuthority = await ensurePrivateDirectory(
      loopsDirectory,
      undefined,
      appDataAuthority
    );
    const candidateRootAuthority = await ensurePrivateDirectory(
      rootDirectory,
      undefined,
      loopsAuthority
    );
    if (this.rootAuthority) {
      assertSameDirectoryAuthority(this.rootAuthority, candidateRootAuthority);
      await assertDirectoryAuthority(this.rootAuthority);
      return;
    }
    this.rootAuthority = candidateRootAuthority;
    this.canonicalRootDirectory = candidateRootAuthority.canonicalPath;
  }

  private requireRootAuthority(): DirectoryAuthority {
    if (!this.rootAuthority) throw new Error('Loop evidence root authority was not initialized');
    return this.rootAuthority;
  }

  private reserveRun(directory: string): void {
    this.activeRuns.set(directory, (this.activeRuns.get(directory) ?? 0) + 1);
  }

  private releaseRun(directory: string): void {
    const count = this.activeRuns.get(directory);
    if (count === undefined) return;
    if (count === 1) this.activeRuns.delete(directory);
    else this.activeRuns.set(directory, count - 1);
  }
}

class LoopEvidenceRun implements LoopEvidenceRunPort {
  readonly directory: string;
  private readonly rootAuthority: DirectoryAuthority;
  private readonly runAuthority: DirectoryAuthority;
  private readonly screenshotsAuthority: DirectoryAuthority;
  private eventIdentity: FilesystemIdentity | null = null;
  private readonly eventPath: string;
  private readonly screenshotsPath: string;
  private readonly filesystem: EvidenceFilesystem;
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
  private eventStreamPoisoned = false;
  private operationTail: Promise<void> = Promise.resolve();

  private constructor(input: LoopEvidenceRunOptions, screenshotsAuthority: DirectoryAuthority) {
    this.rootAuthority = input.rootAuthority;
    this.runAuthority = input.runAuthority;
    this.screenshotsAuthority = screenshotsAuthority;
    this.directory = input.runAuthority.path;
    this.eventPath = join(this.directory, EVENTS_FILE);
    this.screenshotsPath = screenshotsAuthority.path;
    this.filesystem = input.filesystem;
    this.now = input.now;
    this.maxEvents = input.maxEvents;
    this.maxEventBytes = input.maxEventBytes;
    this.maxScreenshots = input.maxScreenshots;
    this.maxScreenshotBytes = input.maxScreenshotBytes;
    this.maxScreenshotBytesPerRun = input.maxScreenshotBytesPerRun;
    this.onFinished = input.onFinished;
  }

  static async create(input: LoopEvidenceRunOptions): Promise<LoopEvidenceRun> {
    await assertDirectoryAuthority(input.rootAuthority);
    await assertDirectoryAuthority(input.runAuthority);
    const screenshotsPath = join(input.runAuthority.path, SCREENSHOTS_DIR);
    const screenshotsAuthority = await ensurePrivateDirectory(
      screenshotsPath,
      false,
      input.runAuthority
    );
    const run = new LoopEvidenceRun(input, screenshotsAuthority);
    await run.assertDirectories();
    const hookInput = {
      kind: 'events',
      operation: 'create',
      path: run.eventPath,
    } satisfies EvidenceFileHookInput;
    await run.filesystem.beforeFileOpen(hookInput);
    let eventHandle: Awaited<ReturnType<typeof open>> | null = null;
    let primaryError: unknown = null;
    try {
      eventHandle = await open(
        run.eventPath,
        constants.O_APPEND |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600
      );
      await run.filesystem.afterFileOpen(hookInput);
      run.eventIdentity = await verifyOpenedFile(eventHandle, run.eventPath, run.runAuthority);
      await eventHandle.chmod(0o600);
      run.eventIdentity = await verifyOpenedFile(
        eventHandle,
        run.eventPath,
        run.runAuthority,
        run.eventIdentity
      );
    } catch (error) {
      primaryError = error;
    }
    if (eventHandle) {
      try {
        await run.filesystem.closeFile({ ...hookInput, handle: eventHandle });
      } catch (closeError) {
        if (primaryError !== null) {
          throw aggregateCleanupFailure(
            primaryError,
            [closeError],
            'Loop evidence event creation cleanup failed'
          );
        }
        throw closeError;
      }
    }
    if (primaryError !== null) throw primaryError;
    if ((await readdir(run.screenshotsPath)).length > 0) {
      throw new Error('Loop evidence screenshots directory was not empty after creation');
    }
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
      let artifactIdentity: FilesystemIdentity | null = null;
      const hookInput = {
        kind: 'screenshot',
        operation: 'create',
        path: artifactPath,
      } satisfies EvidenceFileHookInput;
      try {
        await this.filesystem.beforeFileOpen(hookInput);
        handle = await open(
          artifactPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        );
        await this.filesystem.afterFileOpen(hookInput);
        artifactIdentity = await verifyOpenedFile(handle, artifactPath, this.screenshotsAuthority);
        await handle.chmod(0o600);
        artifactIdentity = await verifyOpenedFile(
          handle,
          artifactPath,
          this.screenshotsAuthority,
          artifactIdentity
        );
        await handle.writeFile(input.data);
        await this.filesystem.afterFileWrite(hookInput);
        await verifyOpenedFile(handle, artifactPath, this.screenshotsAuthority, artifactIdentity);
        await this.filesystem.closeFile({ ...hookInput, handle });
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
        const cleanupErrors: unknown[] = [];
        if (handle) {
          try {
            await this.filesystem.closeFile({ ...hookInput, handle });
          } catch (closeError) {
            cleanupErrors.push(closeError);
          }
        }
        if (artifactIdentity) {
          try {
            await removeVerifiedFile(
              this.screenshotsAuthority,
              artifactPath,
              this.filesystem,
              artifactIdentity
            );
          } catch (removeError) {
            cleanupErrors.push(removeError);
          }
        }
        if (cleanupErrors.length > 0) {
          throw aggregateCleanupFailure(
            error,
            cleanupErrors,
            'Loop evidence screenshot cleanup failed'
          );
        }
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

  async abandon(): Promise<void> {
    await this.enqueue(async () => {
      if (this.finished) return;
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
    if (!this.eventIdentity) throw new Error('Loop evidence event authority is unavailable');
    const hookInput = {
      kind: 'events',
      operation: 'append',
      path: this.eventPath,
    } satisfies EvidenceFileHookInput;
    await this.filesystem.beforeFileOpen(hookInput);
    const handle = await open(
      this.eventPath,
      constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    let primaryError: unknown = null;
    let writeStarted = false;
    try {
      await this.filesystem.afterFileOpen(hookInput);
      await verifyOpenedFile(handle, this.eventPath, this.runAuthority, this.eventIdentity);
      await handle.chmod(0o600);
      await verifyOpenedFile(handle, this.eventPath, this.runAuthority, this.eventIdentity);
      writeStarted = true;
      await handle.writeFile(line, 'utf8');
      await this.filesystem.afterFileWrite(hookInput);
      await verifyOpenedFile(handle, this.eventPath, this.runAuthority, this.eventIdentity);
    } catch (error) {
      primaryError = error;
    }
    try {
      await this.filesystem.closeFile({ ...hookInput, handle });
    } catch (closeError) {
      if (writeStarted) this.eventStreamPoisoned = true;
      if (primaryError !== null) {
        throw aggregateCleanupFailure(
          primaryError,
          [closeError],
          'Loop evidence event append cleanup failed'
        );
      }
      throw closeError;
    }
    if (primaryError !== null) {
      if (writeStarted) this.eventStreamPoisoned = true;
      throw primaryError;
    }
    this.sequence += 1;
  }

  private async assertDirectories(): Promise<void> {
    await assertDirectoryAuthority(this.rootAuthority);
    await assertDirectoryAuthority(this.runAuthority);
    await assertDirectoryAuthority(this.screenshotsAuthority);
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
    if (this.eventStreamPoisoned) {
      throw new Error('Loop evidence event stream is unavailable after an uncertain append');
    }
  }
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
  return redactEvidenceSecrets(stripUrlDetails(value.slice(0, limit * 4))).slice(0, limit);
}

function redactEvidenceSecrets(value: string): string {
  return redactAll(value.replace(cookieAssignmentPattern, '[REDACTED_COOKIE]'));
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

function createEvidenceFilesystem(hooks: LoopEvidenceStoreTestHooks = {}): EvidenceFilesystem {
  return {
    afterRunDirectoryCreate: async (path) => {
      await hooks.afterRunDirectoryCreate?.(path);
    },
    beforeFileOpen: async (input) => {
      await hooks.beforeFileOpen?.(input);
    },
    afterFileOpen: async (input) => {
      await hooks.afterFileOpen?.(input);
    },
    afterFileWrite: async (input) => {
      await hooks.afterFileWrite?.(input);
    },
    closeFile: hooks.closeFile ?? (async ({ handle }) => await handle.close()),
    beforeRemove: async (input) => {
      await hooks.beforeRemove?.(input);
    },
    removeFile: hooks.removeFile ?? (async (path) => await unlink(path)),
    removeDirectory: hooks.removeDirectory ?? (async (path) => await rmdir(path)),
  };
}

async function ensurePrivateDirectory(
  path: string,
  allowExisting = true,
  parent?: DirectoryAuthority
): Promise<DirectoryAuthority> {
  try {
    await mkdir(path, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (!allowExisting || !isNodeError(error) || error.code !== 'EEXIST') throw error;
  }
  return await captureDirectoryAuthority(path, parent);
}

/**
 * Pure Node has no portable openat-style API. These immutable identity and canonical-path
 * checks are a fail-closed defense against swaps at every mutation boundary, not a claim that
 * path APIs can defeat an actively oscillating same-user process. O_NOFOLLOW and chmod also do
 * not provide equivalent Windows ACL guarantees, so unusable filesystem identities are rejected.
 */
async function captureDirectoryAuthority(
  path: string,
  parent?: DirectoryAuthority,
  requirePrivate = true
): Promise<DirectoryAuthority> {
  if (parent) {
    assertContainedPath(parent.path, path);
    await assertDirectoryAuthority(parent);
  }
  const first = await lstat(path, { bigint: true });
  assertDirectoryDetails(first, path, requirePrivate);
  const firstIdentity = identityFromStats(first);
  const canonicalPath = await realpath(path);
  const second = await lstat(path, { bigint: true });
  assertDirectoryDetails(second, path, requirePrivate);
  assertSameIdentity(firstIdentity, identityFromStats(second), path);
  if (!sameFilesystemPath(canonicalPath, resolve(path))) {
    throw new Error('Loop evidence directory must not traverse symbolic links');
  }
  if (parent) {
    assertContainedPath(parent.canonicalPath, canonicalPath);
    await assertDirectoryAuthority(parent);
  }
  return {
    path: resolve(path),
    canonicalPath,
    identity: firstIdentity,
    requirePrivate,
  };
}

async function assertDirectoryAuthority(authority: DirectoryAuthority): Promise<void> {
  const candidate = await captureDirectoryAuthority(
    authority.path,
    undefined,
    authority.requirePrivate
  );
  assertSameDirectoryAuthority(authority, candidate);
}

function assertSameDirectoryAuthority(
  expected: DirectoryAuthority,
  candidate: DirectoryAuthority
): void {
  if (
    !sameFilesystemPath(expected.path, candidate.path) ||
    !sameFilesystemPath(expected.canonicalPath, candidate.canonicalPath)
  ) {
    throw new Error('Loop evidence directory authority changed');
  }
  assertSameIdentity(expected.identity, candidate.identity, expected.path);
}

function assertDirectoryDetails(
  details: Awaited<ReturnType<typeof lstat>>,
  path: string,
  requirePrivate: boolean
): void {
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('Loop evidence directory must not traverse symbolic links');
  }
  identityFromStats(details);
  if (
    requirePrivate &&
    process.platform !== 'win32' &&
    (BigInt(details.mode) & BigInt(0o077)) !== BigInt(0)
  ) {
    throw new Error(`Loop evidence directory permissions are not private: ${path}`);
  }
}

async function verifyOpenedFile(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  parent: DirectoryAuthority,
  expectedIdentity?: FilesystemIdentity
): Promise<FilesystemIdentity> {
  assertContainedPath(parent.path, path);
  await assertDirectoryAuthority(parent);
  const firstHandleDetails = await handle.stat({ bigint: true });
  if (!firstHandleDetails.isFile()) {
    throw new Error('Loop evidence file handle must reference a regular file');
  }
  const handleIdentity = identityFromStats(firstHandleDetails);
  if (expectedIdentity) assertSameIdentity(expectedIdentity, handleIdentity, path);

  const firstPathDetails = await lstat(path, { bigint: true });
  if (!firstPathDetails.isFile() || firstPathDetails.isSymbolicLink()) {
    throw new Error('Loop evidence file path must reference the opened regular file');
  }
  const pathIdentity = identityFromStats(firstPathDetails);
  assertSameIdentity(handleIdentity, pathIdentity, path);
  const canonicalPath = await realpath(path);
  if (!sameFilesystemPath(canonicalPath, resolve(path))) {
    throw new Error('Loop evidence file must not traverse symbolic links');
  }
  assertContainedPath(parent.canonicalPath, canonicalPath);

  await assertDirectoryAuthority(parent);
  const secondPathDetails = await lstat(path, { bigint: true });
  const secondHandleDetails = await handle.stat({ bigint: true });
  if (
    !secondPathDetails.isFile() ||
    secondPathDetails.isSymbolicLink() ||
    !secondHandleDetails.isFile()
  ) {
    throw new Error('Loop evidence file identity changed before mutation');
  }
  assertSameIdentity(handleIdentity, identityFromStats(secondPathDetails), path);
  assertSameIdentity(handleIdentity, identityFromStats(secondHandleDetails), path);
  return handleIdentity;
}

async function removeKnownRunDirectory(
  root: DirectoryAuthority,
  run: DirectoryAuthority,
  filesystem: EvidenceFilesystem
): Promise<void> {
  await assertDirectoryAuthority(root);
  let initialRunDetails: Awaited<ReturnType<typeof lstat>>;
  try {
    initialRunDetails = await lstat(run.path, { bigint: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  assertDirectoryDetails(initialRunDetails, run.path, run.requirePrivate);
  assertSameIdentity(run.identity, identityFromStats(initialRunDetails), run.path);
  await assertDirectoryAuthority(run);
  assertContainedPath(root.path, run.path);
  const entries = await readdir(run.path, { withFileTypes: true });
  await assertDirectoryAuthority(run);
  for (const entry of entries) {
    const entryPath = join(run.path, entry.name);
    if (entry.name === EVENTS_FILE) {
      await removeVerifiedFile(run, entryPath, filesystem, undefined, true);
      continue;
    }
    if (entry.name === SCREENSHOTS_DIR) {
      const details = await lstat(entryPath, { bigint: true });
      if (details.isSymbolicLink()) {
        await removeVerifiedFile(run, entryPath, filesystem, undefined, true);
        continue;
      }
      if (!details.isDirectory()) {
        throw new Error('Loop evidence screenshots entry was not a directory');
      }
      const screenshots = await captureDirectoryAuthority(entryPath, run);
      await removeKnownScreenshotsDirectory(run, screenshots, filesystem);
      continue;
    }
    throw new Error('Loop evidence run contained an unexpected cleanup entry');
  }
  await removeEmptyDirectory(root, run, filesystem);
}

async function removeKnownScreenshotsDirectory(
  run: DirectoryAuthority,
  screenshots: DirectoryAuthority,
  filesystem: EvidenceFilesystem
): Promise<void> {
  await assertDirectoryAuthority(run);
  await assertDirectoryAuthority(screenshots);
  const entries = await readdir(screenshots.path, { withFileTypes: true });
  await assertDirectoryAuthority(screenshots);
  for (const entry of entries) {
    if (!isScreenshotFileName(entry.name)) {
      throw new Error('Loop evidence screenshots contained an unexpected cleanup entry');
    }
    await removeVerifiedFile(
      screenshots,
      join(screenshots.path, entry.name),
      filesystem,
      undefined,
      true
    );
  }
  await removeEmptyDirectory(run, screenshots, filesystem);
}

async function removeVerifiedFile(
  parent: DirectoryAuthority,
  path: string,
  filesystem: EvidenceFilesystem,
  expectedIdentity?: FilesystemIdentity,
  allowSymbolicLink = false,
  allowMissing = false
): Promise<void> {
  assertContainedPath(parent.path, path);
  await assertDirectoryAuthority(parent);
  let first: Awaited<ReturnType<typeof lstat>>;
  try {
    first = await lstat(path, { bigint: true });
  } catch (error) {
    if (allowMissing && isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  if (first.isDirectory()) throw new Error('Loop evidence cleanup refused a directory entry');
  if (
    (!first.isFile() && !first.isSymbolicLink()) ||
    (first.isSymbolicLink() && !allowSymbolicLink)
  ) {
    throw new Error('Loop evidence cleanup refused an unexpected file type');
  }
  const firstIdentity = identityFromStats(first);
  if (expectedIdentity) assertSameIdentity(expectedIdentity, firstIdentity, path);
  if (!first.isSymbolicLink()) {
    const canonicalPath = await realpath(path);
    if (!sameFilesystemPath(canonicalPath, resolve(path))) {
      throw new Error('Loop evidence cleanup file must not traverse symbolic links');
    }
    assertContainedPath(parent.canonicalPath, canonicalPath);
  }

  await filesystem.beforeRemove({ kind: 'file', path });
  await assertDirectoryAuthority(parent);
  let second: Awaited<ReturnType<typeof lstat>>;
  try {
    second = await lstat(path, { bigint: true });
  } catch (error) {
    if (allowMissing && isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  if (
    second.isDirectory() ||
    (!second.isFile() && !second.isSymbolicLink()) ||
    (second.isSymbolicLink() && !allowSymbolicLink)
  ) {
    throw new Error('Loop evidence cleanup file type changed before removal');
  }
  assertSameIdentity(firstIdentity, identityFromStats(second), path);
  await filesystem.removeFile(path);
  await assertDirectoryAuthority(parent);
}

async function removeEmptyDirectory(
  parent: DirectoryAuthority,
  directory: DirectoryAuthority,
  filesystem: EvidenceFilesystem
): Promise<void> {
  await assertDirectoryAuthority(parent);
  await assertDirectoryAuthority(directory);
  await filesystem.beforeRemove({ kind: 'directory', path: directory.path });
  await assertDirectoryAuthority(parent);
  await assertDirectoryAuthority(directory);
  if ((await readdir(directory.path)).length > 0) {
    throw new Error('Loop evidence cleanup refused a non-empty directory');
  }
  await assertDirectoryAuthority(parent);
  await assertDirectoryAuthority(directory);
  await filesystem.removeDirectory(directory.path);
  await assertDirectoryAuthority(parent);
}

function identityFromStats(details: {
  dev: number | bigint;
  ino: number | bigint;
}): FilesystemIdentity {
  const dev = BigInt(details.dev);
  const ino = BigInt(details.ino);
  if (dev < BigInt(0) || ino <= BigInt(0)) {
    throw new Error('Loop evidence filesystem identity is unavailable');
  }
  return { dev, ino };
}

function assertSameIdentity(
  expected: FilesystemIdentity,
  candidate: FilesystemIdentity,
  path: string
): void {
  if (expected.dev !== candidate.dev || expected.ino !== candidate.ino) {
    throw new Error(`Loop evidence filesystem identity changed: ${path}`);
  }
}

function isScreenshotFileName(name: string): boolean {
  return /^[a-f0-9]{64}\.(?:jpg|png)$/u.test(name);
}

function aggregateCleanupFailure(
  primaryError: unknown,
  cleanupErrors: unknown[],
  context: string
): AggregateError {
  const summary = cleanupErrors.map(describeError).join('; ');
  return new AggregateError(
    [primaryError, ...cleanupErrors],
    `${context}: ${describeError(primaryError)}; cleanup failed: ${summary}`
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameFilesystemPath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
