import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import { MAX_PROJECT_ICON_BYTES } from '@shared/projects';

const PROJECT_ICON_DIR = 'project-icons';
const PROJECT_ICON_INDEX_FILE = 'project-icons.json';
const NORMALIZED_PROJECT_ICON_SIZE = 256;
const ALLOWED_SOURCE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp']);

function userDataRoot(): string {
  return app.getPath('userData');
}

function iconRoot(): string {
  return path.join(userDataRoot(), PROJECT_ICON_DIR);
}

function indexFilePath(): string {
  return path.join(userDataRoot(), PROJECT_ICON_INDEX_FILE);
}

function buildIconFileStem(projectId: string): string {
  const trimmed = projectId.trim();
  const sanitized = trimmed.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) {
    throw new Error('projectId is invalid');
  }
  // For ids that are already filesystem-safe (UUIDs etc.) the stem matches the
  // raw id and stays migration-friendly. Otherwise append a short hash so two
  // ids that collapse to the same sanitized form ("foo.bar", "foo-bar") can't
  // overwrite each other on disk.
  if (sanitized === trimmed) return sanitized;
  const hash = createHash('sha1').update(projectId).digest('hex').slice(0, 8);
  return `${sanitized}-${hash}`;
}

function resolveStoredIconAbsolutePath(relativeIconPath: string): string {
  if (path.isAbsolute(relativeIconPath)) return relativeIconPath;
  return path.join(userDataRoot(), relativeIconPath);
}

// Resolve symlinks via realpathSync where possible so an attacker can't slip a
// symlink into the managed dir to escape it. Falls back to lexical resolve for
// paths that don't yet exist (the creation-time case).
function realpathOrResolve(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isWithinManagedDir(absolutePath: string): boolean {
  const root = realpathOrResolve(iconRoot());
  const resolved = realpathOrResolve(absolutePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function readIndex(): Record<string, string> {
  try {
    if (!fs.existsSync(indexFilePath())) return {};
    const parsed = JSON.parse(fs.readFileSync(indexFilePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

// Cache the parsed index by mtime so a single getProjects() call doesn't
// re-read + reparse the JSON for every project row. Writers stay on
// readIndex() directly so their R-M-W loop never sees a stale snapshot.
let indexReadCache: { mtimeMs: number; index: Record<string, string> } | null = null;
function readIndexCached(): Record<string, string> {
  try {
    const stat = fs.statSync(indexFilePath(), { throwIfNoEntry: false });
    if (!stat) {
      indexReadCache = null;
      return {};
    }
    if (indexReadCache && indexReadCache.mtimeMs === stat.mtimeMs) {
      return indexReadCache.index;
    }
    const fresh = readIndex();
    indexReadCache = { mtimeMs: stat.mtimeMs, index: fresh };
    return fresh;
  } catch {
    return readIndex();
  }
}

// Atomic write: serialize JSON to a sibling .tmp file then rename, so a crash
// mid-write can't truncate the index and silently wipe every project's icon
// mapping on the next read.
async function writeIndexAtomic(index: Record<string, string>): Promise<void> {
  const target = indexFilePath();
  const tmp = `${target}.tmp`;
  await fsp.mkdir(userDataRoot(), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(index, null, 2));
  await fsp.rename(tmp, target);
}

// Serialize all index-mutating async operations through a single promise chain
// so two concurrent IPC calls (set + clear, or two sets) cannot read the same
// baseline and stomp each other's update.
let indexQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = indexQueue.then(work, work);
  indexQueue = next.catch(() => undefined);
  return next as Promise<T>;
}

// Cache base64 data URLs by absolute path keyed on mtime so the per-project
// read on every getProjects() doesn't re-encode a 256x256 PNG on the
// main-process hot path. Invalidates whenever the file is rewritten.
const dataUrlCache = new Map<string, { mtimeMs: number; dataUrl: string }>();

function readDataUrl(relativeIconPath: string): string | null {
  const absolutePath = resolveStoredIconAbsolutePath(relativeIconPath);
  if (!isWithinManagedDir(absolutePath)) return null;
  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return null;
  const cached = dataUrlCache.get(absolutePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.dataUrl;
  // The on-disk format is always PNG (the write path always emits toPNG()), so
  // pin the served MIME instead of inferring it from the extension.
  const data = fs.readFileSync(absolutePath);
  const dataUrl = `data:image/png;base64,${data.toString('base64')}`;
  dataUrlCache.set(absolutePath, { mtimeMs: stat.mtimeMs, dataUrl });
  return dataUrl;
}

function invalidateDataUrlCache(relativeIconPath: string | null | undefined): void {
  if (!relativeIconPath) return;
  dataUrlCache.delete(resolveStoredIconAbsolutePath(relativeIconPath));
}

async function removeManagedIconFile(relativeIconPath: string | null | undefined): Promise<void> {
  if (!relativeIconPath) return;
  const absolutePath = resolveStoredIconAbsolutePath(relativeIconPath);
  if (!isWithinManagedDir(absolutePath)) return;
  await fsp.rm(absolutePath, { force: true });
  invalidateDataUrlCache(relativeIconPath);
}

function renderNormalizedPng(sourceBytes: Buffer): Buffer {
  const image = nativeImage.createFromBuffer(sourceBytes);
  if (image.isEmpty()) {
    throw new Error('Selected icon could not be processed.');
  }
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) {
    throw new Error('Selected icon has invalid dimensions.');
  }
  const cropSize = Math.min(width, height);
  const cropped =
    width === height
      ? image
      : image.crop({
          x: Math.max(0, Math.floor((width - cropSize) / 2)),
          y: Math.max(0, Math.floor((height - cropSize) / 2)),
          width: cropSize,
          height: cropSize,
        });
  return cropped
    .resize({
      width: NORMALIZED_PROJECT_ICON_SIZE,
      height: NORMALIZED_PROJECT_ICON_SIZE,
      quality: 'best',
    })
    .toPNG();
}

async function readSourceBytesNoFollow(absoluteSourcePath: string): Promise<Buffer> {
  // Open with O_NOFOLLOW so a symlink at the leaf throws ELOOP before any read,
  // then stat + read from the same fd to close the TOCTOU window where a swap
  // could happen between stat and read. fs.constants.O_NOFOLLOW is undefined
  // on Windows; OR'ing 0 there is a no-op (Windows doesn't follow POSIX
  // symlinks for opens anyway).
  const noFollow = (fs.constants.O_NOFOLLOW as number | undefined) ?? 0;
  const handle = await fsp.open(absoluteSourcePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error('Selected icon must be a regular file.');
    }
    if (stat.size > MAX_PROJECT_ICON_BYTES) {
      throw new Error('Project icon must be 2MB or smaller.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Returns the renderer-facing data URL for a project's icon, or null. */
export function getStoredProjectIconDataUrl(projectId: string): string | null {
  const id = projectId?.trim();
  if (!id) return null;
  const relativeIconPath = readIndexCached()[id];
  if (!relativeIconPath) return null;
  return readDataUrl(relativeIconPath);
}

export function setStoredProjectIconForProject(args: {
  projectId: string;
  sourcePath: string;
}): Promise<{ iconDataUrl: string }> {
  return enqueue(async () => {
    const id = args.projectId?.trim();
    if (!id) throw new Error('projectId is required');
    const sourcePath = args.sourcePath?.trim();
    if (!sourcePath) throw new Error('sourcePath is required');

    const absoluteSourcePath = path.resolve(sourcePath);
    if (!ALLOWED_SOURCE_EXTENSIONS.has(path.extname(absoluteSourcePath).toLowerCase())) {
      throw new Error('Unsupported icon format. Use PNG, JPG, or WEBP.');
    }
    const sourceBytes = await readSourceBytesNoFollow(absoluteSourcePath);

    const stem = buildIconFileStem(id);
    const relativeIconPath = path.join(PROJECT_ICON_DIR, `${stem}.png`);
    const absoluteDestPath = resolveStoredIconAbsolutePath(relativeIconPath);
    const normalizedPng = renderNormalizedPng(sourceBytes);

    await fsp.mkdir(iconRoot(), { recursive: true });
    await fsp.writeFile(absoluteDestPath, normalizedPng);
    invalidateDataUrlCache(relativeIconPath);

    const index = readIndex();
    const previousIconPath = index[id] ?? null;
    const wasOverwrite =
      previousIconPath &&
      path.resolve(resolveStoredIconAbsolutePath(previousIconPath)) ===
        path.resolve(absoluteDestPath);

    index[id] = relativeIconPath;
    try {
      await writeIndexAtomic(index);
    } catch (error) {
      // Roll back the freshly-written file (unless it overwrote the previous
      // entry's file, in which case we'd be deleting still-indexed bytes).
      if (!wasOverwrite) {
        await fsp.rm(absoluteDestPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }

    if (previousIconPath && !wasOverwrite) {
      await removeManagedIconFile(previousIconPath).catch(() => undefined);
    }

    const dataUrl = readDataUrl(relativeIconPath);
    if (!dataUrl) throw new Error('Failed to read newly-written project icon');
    return { iconDataUrl: dataUrl };
  });
}

export function clearStoredProjectIconForProject(projectId: string): Promise<void> {
  return enqueue(async () => {
    const id = projectId?.trim();
    if (!id) return;
    const index = readIndex();
    const existing = index[id];
    if (existing === undefined) return;

    delete index[id];
    await writeIndexAtomic(index);
    await removeManagedIconFile(existing);
  });
}
