import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fileKey,
  fileMutationKey,
  filesClientScope,
  nativeFilePath,
  parentFilePaths,
} from './runtime-client';

describe('Files runtime client paths', () => {
  it('binds native paths to a structured runtime root', () => {
    const rootPath = path.resolve('repo');
    const filePath = path.join(rootPath, 'src', 'file.ts');
    const files = filesClientScope({} as never, rootPath);

    expect(fileKey(files, filePath)).toMatchObject({
      relative: 'src/file.ts',
    });
    expect(fileMutationKey(files, filePath)).toMatchObject({
      path: 'src/file.ts',
    });
    expect(nativeFilePath(files, 'src/file.ts' as never)).toBe(filePath);
  });

  it('expands a portable path into parent-first directory candidates', () => {
    expect(parentFilePaths('a/b/c' as never)).toEqual(['a', 'a/b', 'a/b/c']);
  });
});
