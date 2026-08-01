import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  clonePendingCleanup,
  parseCleanRoomPendingCleanup,
  type CleanRoomCleanupJournal,
  type CleanRoomPendingCleanup,
} from './cleanup-journal';

const VERSION = '1';
const MAX_RECORDS = 128;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

type JournalFile = { version: typeof VERSION; records: CleanRoomPendingCleanup[] };

export class DurableCleanRoomCleanupJournal implements CleanRoomCleanupJournal {
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (!isAbsolute(path)) throw new TypeError('Clean-room cleanup journal path must be absolute.');
    this.path = resolve(path);
  }

  async load(cleanupId: string): Promise<CleanRoomPendingCleanup | undefined> {
    return this.serialize(async () => {
      const file = await this.read();
      const record = file.records.find((candidate) => candidate.cleanupId === cleanupId);
      return record ? clonePendingCleanup(record) : undefined;
    });
  }

  async list(): Promise<CleanRoomPendingCleanup[]> {
    return this.serialize(async () => (await this.read()).records.map(clonePendingCleanup));
  }

  async save(record: CleanRoomPendingCleanup, expectedRevision: number | null): Promise<boolean> {
    return this.serialize(async () => {
      const parsed = parseCleanRoomPendingCleanup(record);
      if (!parsed.success) return false;
      const file = await this.read();
      const index = file.records.findIndex((candidate) => candidate.cleanupId === record.cleanupId);
      const current = index < 0 ? undefined : file.records[index];
      if (expectedRevision === null) {
        if (current || record.revision !== 0 || file.records.length >= MAX_RECORDS) return false;
        file.records.push(clonePendingCleanup(parsed.data));
      } else {
        if (
          !current ||
          current.revision !== expectedRevision ||
          record.revision !== expectedRevision + 1
        ) {
          return false;
        }
        file.records[index] = clonePendingCleanup(parsed.data);
      }
      await this.write(file);
      return true;
    });
  }

  async remove(cleanupId: string, expectedRevision: number): Promise<boolean> {
    return this.serialize(async () => {
      const file = await this.read();
      const index = file.records.findIndex((candidate) => candidate.cleanupId === cleanupId);
      if (index < 0 || file.records[index]?.revision !== expectedRevision) return false;
      file.records.splice(index, 1);
      await this.write(file);
      return true;
    });
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async read(): Promise<JournalFile> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { version: VERSION, records: [] };
      throw error;
    }
    if (Buffer.byteLength(text) > MAX_FILE_BYTES)
      throw new Error('Cleanup journal exceeds its limit.');
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw.version !== VERSION || !Array.isArray(raw.records)) {
      throw new Error('Cleanup journal is invalid.');
    }
    if (raw.records.length > MAX_RECORDS) throw new Error('Cleanup journal has too many records.');
    const records = raw.records.map((candidate) => {
      const parsed = parseCleanRoomPendingCleanup(candidate);
      if (!parsed.success) throw new Error('Cleanup journal contains an invalid record.');
      return parsed.data;
    });
    if (new Set(records.map((record) => record.cleanupId)).size !== records.length) {
      throw new Error('Cleanup journal contains duplicate identities.');
    }
    return { version: VERSION, records };
  }

  private async write(file: JournalFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700).catch(() => {});
    const body = `${JSON.stringify(file)}\n`;
    if (Buffer.byteLength(body) > MAX_FILE_BYTES)
      throw new Error('Cleanup journal exceeds its limit.');
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(body, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
      await chmod(this.path, 0o600).catch(() => {});
      const directory = await open(dirname(this.path), 'r').catch(() => undefined);
      try {
        await directory?.sync().catch(() => {});
      } finally {
        await directory?.close().catch(() => {});
      }
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
