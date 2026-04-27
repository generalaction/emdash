import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFileSystem } from './local-fs';

describe('LocalFileSystem (Windows specific behavior simulation)', () => {
  it('should correctly resolve absolute Windows paths when they are within the project root', async () => {
    // This test simulates the case where projectPath is absolute (e.g., C:\project)
    // and we try to resolve an absolute path (e.g., C:\project\file.txt)
    // We use path.win32.resolve to simulate the logic since the actual resolve call
    // in local-fs.ts uses the platform-specific path.resolve.

    // We only run this test on Windows to ensure actual behavior is verified.
    if (process.platform !== 'win32') {
      return;
    }

    const drive = path.parse(process.cwd()).root;
    const projectPath = path.join(drive, 'test-project');
    const fsService = new LocalFileSystem(projectPath);

    // This is the core of the fix: path.resolve(projectPath, absolutePathInsideProject)
    // should yield the absolutePathInsideProject, not projectPath + absolutePathInsideProject.
    const inputPath = path.join(projectPath, 'file.txt');

    // We can't easily mock the internal fs.stat but we can verify resolvePath behavior
    // by calling a method that uses it, like exists()
    // However, resolvePath is private. We can check if it throws "Path traversal detected"
    // which was the symptom of the bug.

    const result = await fsService.exists(inputPath);
    // Even if it returns false (because file doesn't exist), it should NOT throw Path traversal
    expect(result).toBe(false);
  });

  it('should correctly handle forward slash in absolute Windows paths', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const drive = path.parse(process.cwd()).root;
    const projectPath = path.join(drive, 'test-project').replace(/\\/g, '/');
    const fsService = new LocalFileSystem(projectPath);

    const inputPath = path.join(projectPath, 'file.txt').replace(/\\/g, '/');
    const result = await fsService.exists(inputPath);
    expect(result).toBe(false);
  });
});
