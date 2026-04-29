import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PROJECT_ICON_BYTES } from '@shared/projects';
import {
  clearStoredProjectIconForProject,
  getStoredProjectIconDataUrl,
  setStoredProjectIconForProject,
} from './storage';

const getPathMock = vi.fn();
const createFromBufferMock = vi.fn();
const cropMock = vi.fn();
const resizeMock = vi.fn();
const toPNGMock = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => getPathMock(name),
  },
  nativeImage: {
    createFromBuffer: (bytes: Buffer) => createFromBufferMock(bytes),
  },
}));

describe('projectIconStorage', () => {
  let tempDir: string;
  let userDataDir: string;
  let sourceDir: string;
  const iconDir = () => path.join(userDataDir, 'project-icons');
  const indexPath = () => path.join(userDataDir, 'project-icons.json');

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-icon-storage-test-'));
    userDataDir = path.join(tempDir, 'user-data');
    sourceDir = path.join(tempDir, 'source');

    fs.mkdirSync(sourceDir, { recursive: true });
    getPathMock.mockReturnValue(userDataDir);

    cropMock.mockImplementation(
      (rect: { x: number; y: number; width: number; height: number }) => ({
        getSize: () => ({ width: rect.width, height: rect.height }),
        crop: cropMock,
        resize: resizeMock,
        toPNG: toPNGMock,
        isEmpty: () => false,
      })
    );
    resizeMock.mockImplementation(() => ({ toPNG: toPNGMock }));
    toPNGMock.mockReturnValue(Buffer.from('normalized-project-icon'));
    createFromBufferMock.mockImplementation((bytes: Buffer) => {
      const lowered = bytes.toString('utf8').toLowerCase();
      const size =
        lowered.includes('wide') || lowered.includes('webp') || lowered.includes('replacement')
          ? { width: 480, height: 240 }
          : { width: 128, height: 128 };
      return {
        isEmpty: () => false,
        getSize: () => size,
        crop: cropMock,
        resize: resizeMock,
        toPNG: toPNGMock,
      };
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes the normalized PNG and the index entry, then returns a data URL', async () => {
    const sourcePath = path.join(sourceDir, 'icon.png');
    fs.writeFileSync(sourcePath, Buffer.from('png-test-bytes'));

    const result = await setStoredProjectIconForProject({
      projectId: 'project-1',
      sourcePath,
    });

    const storedFile = path.join(iconDir(), 'project-1.png');
    expect(fs.existsSync(storedFile)).toBe(true);
    expect(fs.readFileSync(storedFile)).toEqual(Buffer.from('normalized-project-icon'));
    expect(JSON.parse(fs.readFileSync(indexPath(), 'utf8'))).toEqual({
      'project-1': path.join('project-icons', 'project-1.png'),
    });
    expect(result.iconDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(getStoredProjectIconDataUrl('project-1')).toBe(result.iconDataUrl);
  });

  it('always normalizes uploads to png even when the source format differs', async () => {
    const original = path.join(sourceDir, 'icon.png');
    const replacement = path.join(sourceDir, 'icon.webp');
    fs.writeFileSync(original, Buffer.from('original-icon'));
    fs.writeFileSync(replacement, Buffer.from('replacement-icon'));

    await setStoredProjectIconForProject({ projectId: 'project-1', sourcePath: original });
    await setStoredProjectIconForProject({ projectId: 'project-1', sourcePath: replacement });

    expect(fs.existsSync(path.join(iconDir(), 'project-1.png'))).toBe(true);
    expect(fs.existsSync(path.join(iconDir(), 'project-1.webp'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(indexPath(), 'utf8'))).toEqual({
      'project-1': path.join('project-icons', 'project-1.png'),
    });
  });

  it('clears both the stored icon file and the index entry', async () => {
    const sourcePath = path.join(sourceDir, 'icon.png');
    fs.writeFileSync(sourcePath, Buffer.from('png-test-bytes'));
    await setStoredProjectIconForProject({ projectId: 'project-1', sourcePath });

    await clearStoredProjectIconForProject('project-1');

    expect(fs.existsSync(path.join(iconDir(), 'project-1.png'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(indexPath(), 'utf8'))).toEqual({});
    expect(getStoredProjectIconDataUrl('project-1')).toBeNull();
  });

  it('sanitizes project ids and disambiguates collisions with a short hash suffix', async () => {
    const sourcePath = path.join(sourceDir, 'icon.png');
    fs.writeFileSync(sourcePath, Buffer.from('png-test-bytes'));

    await setStoredProjectIconForProject({ projectId: '../private repo', sourcePath });
    await setStoredProjectIconForProject({ projectId: '..-private-repo', sourcePath });

    // Both ids collapse to the `private-repo` stem under sanitization, so the
    // hash suffix is what keeps them from overwriting each other on disk.
    const named = fs.readdirSync(iconDir()).filter((f) => f.startsWith('private-repo'));
    expect(named).toHaveLength(2);
    expect(named.every((f) => /^private-repo-[0-9a-f]{8}\.png$/.test(f))).toBe(true);

    // Untouched ids stay flat (no hash suffix) so existing UUID-keyed installs
    // don't need a migration.
    await setStoredProjectIconForProject({ projectId: 'plain-uuid-style-id', sourcePath });
    expect(fs.existsSync(path.join(iconDir(), 'plain-uuid-style-id.png'))).toBe(true);
  });

  it('rejects files larger than 2MB before writing any state', async () => {
    const sourcePath = path.join(sourceDir, 'icon.png');
    fs.writeFileSync(sourcePath, Buffer.alloc(MAX_PROJECT_ICON_BYTES + 1));

    await expect(
      setStoredProjectIconForProject({ projectId: 'project-1', sourcePath })
    ).rejects.toThrow('Project icon must be 2MB or smaller.');

    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('rejects unsupported source formats before writing any state', async () => {
    const sourcePath = path.join(sourceDir, 'icon.txt');
    fs.writeFileSync(sourcePath, Buffer.from('not-an-image'));

    await expect(
      setStoredProjectIconForProject({ projectId: 'project-1', sourcePath })
    ).rejects.toThrow('Unsupported icon format.');

    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('rejects images that nativeImage cannot decode', async () => {
    const sourcePath = path.join(sourceDir, 'empty.png');
    fs.writeFileSync(sourcePath, Buffer.from('bad-png'));
    createFromBufferMock.mockReturnValueOnce({ isEmpty: () => true });

    await expect(
      setStoredProjectIconForProject({ projectId: 'project-1', sourcePath })
    ).rejects.toThrow('Selected icon could not be processed.');

    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('center-crops non-square sources before resizing', async () => {
    const sourcePath = path.join(sourceDir, 'wide-icon.webp');
    fs.writeFileSync(sourcePath, Buffer.from('wide-test-bytes'));

    await setStoredProjectIconForProject({ projectId: 'project-1', sourcePath });

    expect(cropMock).toHaveBeenCalledWith({ x: 120, y: 0, width: 240, height: 240 });
    expect(resizeMock).toHaveBeenCalledWith({ width: 256, height: 256, quality: 'best' });
  });

  it('returns null from the read path when the managed icon file is deleted manually', async () => {
    const sourcePath = path.join(sourceDir, 'icon.png');
    fs.writeFileSync(sourcePath, Buffer.from('png-test-bytes'));
    await setStoredProjectIconForProject({ projectId: 'project-1', sourcePath });

    fs.rmSync(path.join(iconDir(), 'project-1.png'), { force: true });

    expect(getStoredProjectIconDataUrl('project-1')).toBeNull();
  });

  it('rejects index entries that point outside the managed icon directory', () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    const escape = path.join(tempDir, 'outside.png');
    fs.writeFileSync(escape, Buffer.from('escape'));
    fs.writeFileSync(indexPath(), JSON.stringify({ 'project-1': escape }));

    expect(getStoredProjectIconDataUrl('project-1')).toBeNull();
  });

  it('serializes concurrent set operations so neither update is lost', async () => {
    const sourceA = path.join(sourceDir, 'a.png');
    const sourceB = path.join(sourceDir, 'b.png');
    fs.writeFileSync(sourceA, Buffer.from('a-bytes'));
    fs.writeFileSync(sourceB, Buffer.from('b-bytes'));

    await Promise.all([
      setStoredProjectIconForProject({ projectId: 'project-a', sourcePath: sourceA }),
      setStoredProjectIconForProject({ projectId: 'project-b', sourcePath: sourceB }),
    ]);

    const index = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    expect(Object.keys(index).sort()).toEqual(['project-a', 'project-b']);
  });

  it('rejects symbolic-link sources before reading their bytes', async () => {
    const real = path.join(sourceDir, 'real.png');
    const link = path.join(sourceDir, 'link.png');
    fs.writeFileSync(real, Buffer.from('png-test-bytes'));
    fs.symlinkSync(real, link);

    await expect(
      setStoredProjectIconForProject({ projectId: 'project-1', sourcePath: link })
    ).rejects.toBeInstanceOf(Error);

    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('rolls back the new file when the index write fails for a fresh project', async () => {
    const sourcePath = path.join(sourceDir, 'icon.png');
    fs.writeFileSync(sourcePath, Buffer.from('png-test-bytes'));

    // Force the rename inside the atomic writer to fail by occupying the index
    // path with a non-empty directory (rename onto a non-empty dir throws).
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(indexPath());
    fs.writeFileSync(path.join(indexPath(), 'block'), '');

    await expect(
      setStoredProjectIconForProject({ projectId: 'fresh-project', sourcePath })
    ).rejects.toBeInstanceOf(Error);

    expect(fs.existsSync(path.join(iconDir(), 'fresh-project.png'))).toBe(false);
  });
});
