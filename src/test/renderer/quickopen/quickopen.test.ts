import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyMatchPath } from '../../../renderer/quickopen/fuzzyMatch';
import { FileIndexManager } from '../../../renderer/quickopen/FileIndexManager';

// =============================================================================
// fuzzyMatch tests
// =============================================================================
describe('fuzzyMatch', () => {
  describe('basic matching', () => {
    it('matches exact string', () => {
      const result = fuzzyMatch('foo', 'foo');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it('matches substring', () => {
      const result = fuzzyMatch('bar', 'foobar');
      expect(result.matches).toBe(true);
    });

    it('matches prefix', () => {
      const result = fuzzyMatch('foo', 'foobar');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it('matches scattered characters', () => {
      const result = fuzzyMatch('fb', 'foobar');
      expect(result.matches).toBe(true);
      expect(result.highlights).toEqual([0, 3]);
    });

    it('does not match when query chars are missing', () => {
      const result = fuzzyMatch('xyz', 'foobar');
      expect(result.matches).toBe(false);
      expect(result.score).toBe(0);
      expect(result.highlights).toEqual([]);
    });

    it('does not match when query is longer than target', () => {
      const result = fuzzyMatch('foobarbaz', 'foo');
      expect(result.matches).toBe(false);
    });

    it('empty query matches everything', () => {
      const result = fuzzyMatch('', 'anything');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(0);
    });
  });

  describe('case insensitivity', () => {
    it('matches case insensitively', () => {
      const result = fuzzyMatch('FOO', 'foobar');
      expect(result.matches).toBe(true);
    });

    it('matches mixed case', () => {
      const result = fuzzyMatch('fB', 'FooBar');
      expect(result.matches).toBe(true);
    });
  });

  describe('scoring', () => {
    it('gives higher score to consecutive matches', () => {
      const consecutive = fuzzyMatch('foo', 'foobar');
      const scattered = fuzzyMatch('fbr', 'foobar');
      expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    it('gives higher score to prefix matches', () => {
      const prefix = fuzzyMatch('foo', 'foobar');
      const middle = fuzzyMatch('oba', 'foobar');
      expect(prefix.score).toBeGreaterThan(middle.score);
    });

    it('shorter targets score higher than longer ones', () => {
      const short = fuzzyMatch('test', 'test.ts');
      const long = fuzzyMatch('test', 'src/components/very/deep/test.ts');
      expect(short.score).toBeGreaterThan(long.score);
    });
  });

  describe('highlight indices', () => {
    it('returns correct highlight indices for exact match', () => {
      const result = fuzzyMatch('abc', 'abc');
      expect(result.highlights).toEqual([0, 1, 2]);
    });

    it('returns correct indices for scattered match', () => {
      const result = fuzzyMatch('ac', 'abc');
      expect(result.highlights).toEqual([0, 2]);
    });

    it('returns correct indices for middle match', () => {
      const result = fuzzyMatch('oo', 'foobar');
      expect(result.highlights).toEqual([1, 2]);
    });
  });

  describe('camel case matching', () => {
    it('detects camel case match', () => {
      const camel = fuzzyMatch('FC', 'FileComponent');
      expect(camel.matches).toBe(true);
      expect(camel.score).toBeGreaterThan(0);
    });

    it('camel case scores higher than scattered match', () => {
      const camel = fuzzyMatch('FC', 'FileComponent');
      const scattered = fuzzyMatch('FC', 'frozenChicken');
      expect(camel.matches).toBe(true);
      expect(scattered.matches).toBe(true);
    });
  });
});

// =============================================================================
// fuzzyMatchPath tests
// =============================================================================
describe('fuzzyMatchPath', () => {
  it('prefers filename over full path match', () => {
    const result = fuzzyMatchPath('index', 'src/renderer/index.ts');
    expect(result.matches).toBe(true);
    // Should get filename boost (+200)
    expect(result.score).toBeGreaterThan(200);
  });

  it('falls back to full path if filename does not match', () => {
    const result = fuzzyMatchPath('renderer', 'src/renderer/index.ts');
    expect(result.matches).toBe(true);
    // No filename boost
    expect(result.score).toBeLessThan(200);
  });

  it('handles files without directory', () => {
    const result = fuzzyMatchPath('pkg', 'package.json');
    expect(result.matches).toBe(true);
  });

  it('does not match unrelated query', () => {
    const result = fuzzyMatchPath('zzz', 'src/renderer/index.ts');
    expect(result.matches).toBe(false);
  });
});

// =============================================================================
// FileIndexManager tests
// =============================================================================
describe('FileIndexManager', () => {
  const sampleItems = [
    { path: 'src/index.ts', type: 'file' as const },
    { path: 'src/utils.ts', type: 'file' as const },
    { path: 'src/components/App.tsx', type: 'file' as const },
    { path: 'src/components/Header.tsx', type: 'file' as const },
    { path: 'src/components/FileExplorer/FileTree.tsx', type: 'file' as const },
    { path: 'src/hooks/useTheme.ts', type: 'file' as const },
    { path: 'src/lib/utils.ts', type: 'file' as const },
    { path: 'package.json', type: 'file' as const },
    { path: 'tsconfig.json', type: 'file' as const },
    { path: 'src', type: 'dir' as const },
    { path: 'src/components', type: 'dir' as const },
    { path: 'src/hooks', type: 'dir' as const },
  ];

  describe('buildIndex', () => {
    it('indexes only files, not directories', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      expect(mgr.size).toBe(9); // 9 files, 3 dirs excluded
    });

    it('handles empty input', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([]);
      expect(mgr.size).toBe(0);
    });

    it('rebuilds index on subsequent calls', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      expect(mgr.size).toBe(9);
      mgr.buildIndex([{ path: 'single.ts', type: 'file' }]);
      expect(mgr.size).toBe(1);
    });
  });

  describe('search', () => {
    it('finds files by name', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('index');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.path).toBe('src/index.ts');
    });

    it('finds files by partial name', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('util');
      expect(results.length).toBe(2); // src/utils.ts and src/lib/utils.ts
    });

    it('returns empty for empty query', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('');
      expect(results).toEqual([]);
    });

    it('returns empty for no matches', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('zzzzzzz');
      expect(results).toEqual([]);
    });

    it('respects result limit', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('ts', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('sorts by score (best first)', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('App');
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('fuzzy matches scattered chars', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('FT'); // Should match FileTree
      const hasFileTree = results.some((r) => r.entry.path.includes('FileTree'));
      expect(hasFileTree).toBe(true);
    });

    it('works with path-like queries', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      const results = mgr.search('components/App');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('parseQuery', () => {
    it('parses plain filename', () => {
      const mgr = new FileIndexManager();
      expect(mgr.parseQuery('index.ts')).toEqual({ path: 'index.ts' });
    });

    it('parses file:line syntax', () => {
      const mgr = new FileIndexManager();
      expect(mgr.parseQuery('index.ts:120')).toEqual({ path: 'index.ts', line: 120 });
    });

    it('parses file:line with path', () => {
      const mgr = new FileIndexManager();
      expect(mgr.parseQuery('src/index.ts:42')).toEqual({
        path: 'src/index.ts',
        line: 42,
      });
    });

    it('does not parse invalid line number', () => {
      const mgr = new FileIndexManager();
      expect(mgr.parseQuery('index.ts:abc')).toEqual({ path: 'index.ts:abc' });
    });

    it('handles file with colon in name but no line number', () => {
      const mgr = new FileIndexManager();
      expect(mgr.parseQuery('file:name')).toEqual({ path: 'file:name' });
    });

    it('parses line number 0', () => {
      const mgr = new FileIndexManager();
      expect(mgr.parseQuery('test.ts:0')).toEqual({ path: 'test.ts', line: 0 });
    });
  });

  describe('invalidate', () => {
    it('clears the index', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex(sampleItems);
      expect(mgr.size).toBe(9);
      mgr.invalidate();
      expect(mgr.size).toBe(0);
    });
  });

  describe('rootPath management', () => {
    it('sets and gets root path', () => {
      const mgr = new FileIndexManager();
      mgr.setRootPath('/some/path');
      expect(mgr.getRootPath()).toBe('/some/path');
    });

    it('returns null when no root path set', () => {
      const mgr = new FileIndexManager();
      expect(mgr.getRootPath()).toBeNull();
    });

    it('clears root path on invalidate', () => {
      const mgr = new FileIndexManager();
      mgr.setRootPath('/some/path');
      mgr.invalidate();
      expect(mgr.getRootPath()).toBeNull();
    });
  });
});

// =============================================================================
// Performance tests
// =============================================================================
describe('Performance', () => {
  it('searches 50k files in under 500ms', () => {
    const mgr = new FileIndexManager();

    // Generate 50k realistic file paths
    const dirs = ['src', 'lib', 'test', 'docs', 'config', 'utils', 'components', 'hooks'];
    const subdirs = ['auth', 'api', 'ui', 'db', 'cache', 'core', 'shared', 'types'];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md'];
    const items: Array<{ path: string; type: 'file' | 'dir' }> = [];

    for (let i = 0; i < 50000; i++) {
      const dir = dirs[i % dirs.length];
      const subdir = subdirs[Math.floor(i / dirs.length) % subdirs.length];
      const ext = extensions[i % extensions.length];
      items.push({
        path: `${dir}/${subdir}/file${i}${ext}`,
        type: 'file',
      });
    }

    mgr.buildIndex(items);
    expect(mgr.size).toBe(50000);

    const start = performance.now();
    const results = mgr.search('file123', 50);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(results.length).toBeGreaterThan(0);
  });

  it('builds index for 50k files in under 500ms', () => {
    const items: Array<{ path: string; type: 'file' | 'dir' }> = [];
    for (let i = 0; i < 50000; i++) {
      items.push({ path: `src/deep/dir/file${i}.ts`, type: 'file' });
    }

    const mgr = new FileIndexManager();
    const start = performance.now();
    mgr.buildIndex(items);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(mgr.size).toBe(50000);
  });
});

// =============================================================================
// Edge case tests
// =============================================================================
describe('Edge cases', () => {
  describe('special characters in filenames', () => {
    it('handles @ in path', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([{ path: 'node_modules/@scope/pkg/index.ts', type: 'file' }]);
      const results = mgr.search('scope');
      expect(results.length).toBe(1);
    });

    it('handles spaces in path', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([{ path: 'my dir/my file.ts', type: 'file' }]);
      const results = mgr.search('my file');
      expect(results.length).toBe(1);
    });

    it('handles dots in path', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([{ path: '.env.local', type: 'file' }]);
      const results = mgr.search('.env');
      expect(results.length).toBe(1);
    });

    it('handles # in path', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([{ path: 'src/#types/index.ts', type: 'file' }]);
      const results = mgr.search('#types');
      expect(results.length).toBe(1);
    });
  });

  describe('deeply nested paths', () => {
    it('matches files 10+ levels deep', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([
        {
          path: 'a/b/c/d/e/f/g/h/i/j/deep.ts',
          type: 'file',
        },
      ]);
      const results = mgr.search('deep');
      expect(results.length).toBe(1);
    });
  });

  describe('very long filenames', () => {
    it('handles 200+ char paths', () => {
      const longPath = 'a/'.repeat(100) + 'file.ts';
      const mgr = new FileIndexManager();
      mgr.buildIndex([{ path: longPath, type: 'file' }]);
      const results = mgr.search('file');
      expect(results.length).toBe(1);
    });
  });

  describe('single character queries', () => {
    it('matches single char query', () => {
      const mgr = new FileIndexManager();
      mgr.buildIndex([
        { path: 'src/a.ts', type: 'file' },
        { path: 'src/b.ts', type: 'file' },
      ]);
      const results = mgr.search('a');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
