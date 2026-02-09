import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LocalFileSystem } from '../LocalFileSystem';
import { FileSystemError, FileSystemErrorCodes } from '../types';

describe('LocalFileSystem', () => {
  let tempDir: string;
  let fsService: LocalFileSystem;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'));
    fsService = new LocalFileSystem(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should throw error when project path is empty', () => {
      expect(() => new LocalFileSystem('')).toThrow(FileSystemError);
      expect(() => new LocalFileSystem('')).toThrow('Project path is required');
    });

    it('should resolve project path', () => {
      const relativePath = 'relative/project';
      const service = new LocalFileSystem(relativePath);
      expect(service).toBeDefined();
    });
  });

  describe('list', () => {
    it('should list files in directory', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2');
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await fsService.list('');

      expect(result.entries).toHaveLength(3);
      expect(result.entries.some((e) => e.path === 'file1.txt' && e.type === 'file')).toBe(true);
      expect(result.entries.some((e) => e.path === 'file2.txt' && e.type === 'file')).toBe(true);
      expect(result.entries.some((e) => e.path === 'subdir' && e.type === 'dir')).toBe(true);
    });

    it('should list files in subdirectory', async () => {
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'nested.txt'), 'nested content');

      const result = await fsService.list('subdir');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].path).toBe('subdir/nested.txt');
    });

    it('should list recursively', async () => {
      fs.mkdirSync(path.join(tempDir, 'level1'));
      fs.writeFileSync(path.join(tempDir, 'level1/file1.txt'), 'content1');
      fs.mkdirSync(path.join(tempDir, 'level1/level2'));
      fs.writeFileSync(path.join(tempDir, 'level1/level2/file2.txt'), 'content2');

      const result = await fsService.list('', { recursive: true });

      expect(result.entries.some((e) => e.path === 'level1')).toBe(true);
      expect(result.entries.some((e) => e.path === 'level1/file1.txt')).toBe(true);
      expect(result.entries.some((e) => e.path === 'level1/level2')).toBe(true);
      expect(result.entries.some((e) => e.path === 'level1/level2/file2.txt')).toBe(true);
    });

    it('should exclude hidden files by default', async () => {
      fs.writeFileSync(path.join(tempDir, 'visible.txt'), 'content');
      fs.writeFileSync(path.join(tempDir, '.hidden'), 'hidden content');

      const result = await fsService.list('');

      expect(result.entries.some((e) => e.path === 'visible.txt')).toBe(true);
      expect(result.entries.some((e) => e.path === '.hidden')).toBe(false);
    });

    it('should include hidden files when specified', async () => {
      fs.writeFileSync(path.join(tempDir, 'visible.txt'), 'content');
      fs.writeFileSync(path.join(tempDir, '.hidden'), 'hidden content');

      const result = await fsService.list('', { includeHidden: true });

      expect(result.entries.some((e) => e.path === '.hidden')).toBe(true);
    });

    it('should apply filter pattern', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.ts'), 'typescript');
      fs.writeFileSync(path.join(tempDir, 'test.js'), 'javascript');
      fs.writeFileSync(path.join(tempDir, 'readme.md'), 'markdown');

      const result = await fsService.list('', { filter: '.*\\.ts$' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].path).toBe('test.ts');
    });

    it('should truncate when maxEntries reached', async () => {
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(tempDir, `file${i}.txt`), 'content');
      }

      const result = await fsService.list('', { maxEntries: 5 });

      expect(result.total).toBe(5);
      expect(result.truncated).toBe(true);
      expect(result.truncateReason).toBe('maxEntries');
    });

    it('should truncate when time budget exceeded', async () => {
      // Create many files to ensure time budget is exceeded
      for (let i = 0; i < 1000; i++) {
        fs.writeFileSync(path.join(tempDir, `file${i}.txt`), 'content');
      }

      const result = await fsService.list('', { recursive: true, timeBudgetMs: 1 });

      expect(result.truncated).toBe(true);
      expect(result.truncateReason).toBe('timeBudget');
    });

    it('should include file metadata', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'test content');

      const result = await fsService.list('');

      expect(result.entries[0].size).toBe(12);
      expect(result.entries[0].mtime).toBeInstanceOf(Date);
      expect(result.entries[0].mode).toBeDefined();
    });
  });

  describe('read', () => {
    it('should read file content', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'Hello, World!');

      const result = await fsService.read('test.txt');

      expect(result.content).toBe('Hello, World!');
      expect(result.truncated).toBe(false);
      expect(result.totalSize).toBe(13);
    });

    it('should throw error when file not found', async () => {
      await expect(fsService.read('nonexistent.txt')).rejects.toThrow(FileSystemError);
      await expect(fsService.read('nonexistent.txt')).rejects.toThrow('File not found');
    });

    it('should throw error when path is directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      await expect(fsService.read('subdir')).rejects.toThrow(FileSystemError);
      await expect(fsService.read('subdir')).rejects.toThrow('Path is a directory');
    });

    it('should truncate large files', async () => {
      const largeContent = 'x'.repeat(300 * 1024); // 300KB
      fs.writeFileSync(path.join(tempDir, 'large.txt'), largeContent);

      const result = await fsService.read('large.txt', 200 * 1024);

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(200 * 1024);
      expect(result.totalSize).toBe(300 * 1024);
    });

    it('should not truncate files under maxBytes', async () => {
      const content = 'Small content';
      fs.writeFileSync(path.join(tempDir, 'small.txt'), content);

      const result = await fsService.read('small.txt', 200 * 1024);

      expect(result.truncated).toBe(false);
      expect(result.content).toBe(content);
    });
  });

  describe('write', () => {
    it('should write file content', async () => {
      const result = await fsService.write('newfile.txt', 'New content');

      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(tempDir, 'newfile.txt'), 'utf-8')).toBe('New content');
    });

    it('should create parent directories', async () => {
      const result = await fsService.write('nested/deep/file.txt', 'Deep content');

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'nested/deep/file.txt'))).toBe(true);
    });

    it('should return bytes written', async () => {
      const content = 'Test content';
      const result = await fsService.write('test.txt', content);

      expect(result.bytesWritten).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should throw error when cannot create directory', async () => {
      // Make tempDir read-only (on Unix systems)
      if (process.platform !== 'win32') {
        fs.chmodSync(tempDir, 0o555);

        try {
          await expect(fsService.write('readonly/test.txt', 'content')).rejects.toThrow(
            FileSystemError
          );
        } finally {
          fs.chmodSync(tempDir, 0o755);
        }
      }
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      fs.writeFileSync(path.join(tempDir, 'exists.txt'), 'content');

      const result = await fsService.exists('exists.txt');

      expect(result).toBe(true);
    });

    it('should return true for existing directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await fsService.exists('subdir');

      expect(result).toBe(true);
    });

    it('should return false for non-existent path', async () => {
      const result = await fsService.exists('nonexistent.txt');

      expect(result).toBe(false);
    });
  });

  describe('stat', () => {
    it('should return file entry for file', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');

      const result = await fsService.stat('test.txt');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('test.txt');
      expect(result?.type).toBe('file');
      expect(result?.size).toBe(7);
    });

    it('should return file entry for directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await fsService.stat('subdir');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('subdir');
      expect(result?.type).toBe('dir');
    });

    it('should return null for non-existent path', async () => {
      const result = await fsService.stat('nonexistent.txt');

      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, 'file1.ts'), 'const foo = "bar";\nfunction test() {}');
      fs.writeFileSync(path.join(tempDir, 'file2.ts'), 'let x = 1;\nconst foo = 2;');
      fs.writeFileSync(path.join(tempDir, 'readme.md'), '# README\nThis is documentation');

      const subdir = path.join(tempDir, 'src');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'main.ts'), 'function main() {\n  console.log(foo);\n}');
    });

    it('should find matches in files', async () => {
      const result = await fsService.search('foo');

      expect(result.total).toBeGreaterThan(0);
      expect(result.matches.some((m) => m.filePath === 'file1.ts')).toBe(true);
      expect(result.matches.some((m) => m.filePath === 'file2.ts')).toBe(true);
      expect(result.matches.some((m) => m.filePath === 'src/main.ts')).toBe(true);
    });

    it('should return match details', async () => {
      const result = await fsService.search('foo');

      const match = result.matches.find((m) => m.filePath === 'file1.ts');
      expect(match).toBeDefined();
      expect(match?.line).toBe(1);
      expect(match?.column).toBeGreaterThan(0);
      expect(match?.content).toContain('foo');
    });

    it('should respect maxResults', async () => {
      const result = await fsService.search('foo', { maxResults: 2 });

      expect(result.total).toBe(2);
      expect(result.truncated).toBe(true);
    });

    it('should filter by file extensions', async () => {
      const result = await fsService.search('foo', { fileExtensions: ['.ts'] });

      expect(result.matches.every((m) => m.filePath.endsWith('.ts'))).toBe(true);
    });

    it('should filter by file pattern', async () => {
      const result = await fsService.search('foo', { filePattern: '*.md' });

      expect(result.total).toBe(0);
    });

    it('should be case-insensitive by default', async () => {
      const result1 = await fsService.search('FOO');
      const result2 = await fsService.search('foo');

      expect(result1.total).toBe(result2.total);
    });

    it('should respect caseSensitive option', async () => {
      const result = await fsService.search('FOO', { caseSensitive: true });

      expect(result.total).toBe(0);
    });

    it('should skip binary files', async () => {
      // Create a "binary" file with null bytes
      fs.writeFileSync(path.join(tempDir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

      const result = await fsService.search('\x00');

      expect(result.matches).toHaveLength(0);
    });

    it('should skip ignored directories', async () => {
      const nodeModules = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nodeModules);
      fs.writeFileSync(path.join(nodeModules, 'test.ts'), 'const foo = "ignored";');

      const result = await fsService.search('foo');

      expect(result.matches.some((m) => m.filePath.includes('node_modules'))).toBe(false);
    });

    it('should track files searched', async () => {
      const result = await fsService.search('foo');

      expect(result.filesSearched).toBeGreaterThan(0);
    });
  });

  describe('remove', () => {
    it('should remove file', async () => {
      fs.writeFileSync(path.join(tempDir, 'delete.txt'), 'content');

      const result = await fsService.remove('delete.txt');

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'delete.txt'))).toBe(false);
    });

    it('should fail when file not found', async () => {
      const result = await fsService.remove('nonexistent.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should fail when path is directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await fsService.remove('subdir');

      expect(result.success).toBe(false);
      expect(result.error).toContain('directory');
    });

    it('should retry with chmod on permission error', async () => {
      if (process.platform !== 'win32') {
        const filePath = path.join(tempDir, 'readonly.txt');
        fs.writeFileSync(filePath, 'content');
        fs.chmodSync(filePath, 0o444);

        try {
          const result = await fsService.remove('readonly.txt');
          expect(result.success).toBe(true);
        } finally {
          // Restore permissions for cleanup
          try {
            fs.chmodSync(filePath, 0o666);
          } catch {
            // Ignore
          }
        }
      }
    });
  });

  describe('readImage', () => {
    it('should read image as data URL', async () => {
      // Create a minimal valid PNG file (1x1 transparent pixel)
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      fs.writeFileSync(path.join(tempDir, 'test.png'), pngBuffer);

      const result = await fsService.readImage('test.png');

      expect(result.success).toBe(true);
      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(pngBuffer.length);
    });

    it('should reject unsupported image formats', async () => {
      // bmp is not in the allowed list
      fs.writeFileSync(path.join(tempDir, 'test.xyz'), 'fake-data');

      const result = await fsService.readImage('test.xyz');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported image format');
    });

    it('should fail when image not found', async () => {
      const result = await fsService.readImage('nonexistent.png');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when path is directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'images'));

      // Directories don't have extensions, so this will fail with unsupported format
      // or directory error depending on implementation order
      const result = await fsService.readImage('images');

      expect(result.success).toBe(false);
    });

    it('should reject oversized images', async () => {
      // Create a fake large "image" file
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      fs.writeFileSync(path.join(tempDir, 'large.png'), largeBuffer);

      const result = await fsService.readImage('large.png');

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('path traversal protection', () => {
    it('should block absolute path traversal', async () => {
      // Absolute paths get normalized by resolvePath
      await expect(fsService.read('/etc/passwd')).rejects.toThrow();
    });

    it('should block relative path traversal', async () => {
      await expect(fsService.read('../package.json')).rejects.toThrow();
    });

    it('should block nested path traversal', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));
      fs.writeFileSync(path.join(tempDir, 'subdir/file.txt'), 'content');

      await expect(fsService.read('subdir/../../../etc/passwd')).rejects.toThrow();
    });

    it('should normalize paths with double slashes', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');

      const result = await fsService.read('//test.txt');

      expect(result.content).toBe('content');
    });

    it('should allow valid subpaths', async () => {
      fs.mkdirSync(path.join(tempDir, 'valid'));
      fs.mkdirSync(path.join(tempDir, 'valid/nested'));
      fs.writeFileSync(path.join(tempDir, 'valid/nested/file.txt'), 'content');

      const result = await fsService.read('valid/nested/file.txt');

      expect(result.content).toBe('content');
    });
  });

  describe('large file handling', () => {
    it('should handle files larger than default maxBytes', async () => {
      const largeContent = 'x'.repeat(500 * 1024); // 500KB
      fs.writeFileSync(path.join(tempDir, 'large.txt'), largeContent);

      const result = await fsService.read('large.txt');

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(200 * 1024); // Default limit
    });

    it('should handle custom maxBytes limit', async () => {
      const content = 'x'.repeat(100);
      fs.writeFileSync(path.join(tempDir, 'medium.txt'), content);

      const result = await fsService.read('medium.txt', 50);

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(50);
    });
  });
});
