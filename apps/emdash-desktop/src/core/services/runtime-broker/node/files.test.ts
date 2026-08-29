import { describe, expect, it } from 'vitest';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import {
  fileKey,
  fileRelativePath,
  filesClientScope,
  nativeFilePath,
  parentFilePaths,
} from './files';

describe('Files runtime client paths', () => {
  it('preserves a POSIX target root independently of the desktop path dialect', () => {
    const files = filesClientScope({} as never, '/home/user/repo/./');

    expect(files.root).toEqual({
      root: { kind: 'posix' },
      segments: ['home', 'user', 'repo'],
    });
    expect(nativePathFromHost(fileKey(files, '/home/user/repo/src/../file.ts').path)).toBe(
      '/home/user/repo/file.ts'
    );
    expect(nativePathFromHost(fileKey(files, '/home/user/repo/src\\file.ts').path)).toBe(
      '/home/user/repo/src\\file.ts'
    );
    expect(nativeFilePath(files, 'src/file.ts' as never)).toBe('/home/user/repo/src/file.ts');
  });

  it('preserves Windows drive paths on a host-independent test process', () => {
    const files = filesClientScope({} as never, 'C:\\repo');

    expect(files.root).toEqual({
      root: { kind: 'drive', driveLetter: 'C' },
      segments: ['repo'],
    });
    expect(fileRelativePath(files, 'C:/repo/src/file.ts')).toBe('src/file.ts');
    expect(nativePathFromHost(fileKey(files, 'C:\\repo\\src\\file.ts').path)).toBe(
      'C:\\repo\\src\\file.ts'
    );
    expect(fileRelativePath(files, 'c:\\REPO\\src\\file.ts')).toBe('src/file.ts');
  });

  it('preserves UNC roots and accepts an already structured root', () => {
    const root = hostPathFromNative('\\\\server\\share\\repo');
    const files = filesClientScope({} as never, root);

    expect(files.root).toBe(root);
    expect(nativePathFromHost(fileKey(files, '\\\\server\\share\\repo\\src\\file.ts').path)).toBe(
      '\\\\server\\share\\repo\\src\\file.ts'
    );
    expect(fileRelativePath(files, '\\\\SERVER\\SHARE\\REPO\\src\\file.ts')).toBe('src/file.ts');
  });

  it('keeps POSIX containment case-sensitive', () => {
    const files = filesClientScope({} as never, '/home/user/repo');

    expect(() => fileRelativePath(files, '/home/user/REPO/file.ts')).toThrow('outside root');
  });

  it('rejects relative, outside, and cross-root paths instead of resolving them on the desktop', () => {
    expect(() => filesClientScope({} as never, 'repo')).toThrow('absolute');

    const posix = filesClientScope({} as never, '/home/user/repo');
    expect(() => fileKey(posix, '/home/user/outside/file.ts')).toThrow('outside root');
    expect(() => fileKey(posix, 'C:\\repo\\file.ts')).toThrow('not compatible');
  });

  it('expands a portable path into parent-first directory candidates', () => {
    expect(parentFilePaths('a/b/c' as never)).toEqual(['a', 'a/b', 'a/b/c']);
  });
});
