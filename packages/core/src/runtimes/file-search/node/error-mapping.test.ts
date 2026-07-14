import { describe, expect, it } from 'vitest';
import {
  toExpectedFileSearchIoError,
  toExpectedPathIndexError,
  toExpectedRootAccessError,
  toExpectedRootError,
} from './error-mapping';
import { RootWatchError } from './path/index/errors';
import { hostPath as absolute } from './testing/paths';

describe('file-search API error mapping', () => {
  const root = absolute('/workspace');

  it('maps operational Node and SQLite failures to typed I/O errors', () => {
    expect(
      toExpectedFileSearchIoError(
        root,
        Object.assign(new Error('file too large'), { code: 'EFBIG' }),
        'fallback'
      )
    ).toMatchObject({ type: 'io', message: 'file too large' });
    expect(
      toExpectedFileSearchIoError(
        root,
        Object.assign(new Error('database corrupt'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 11,
        }),
        'fallback'
      )
    ).toMatchObject({ type: 'io', message: 'database corrupt' });
  });

  it('does not hide SQLite constraints or unknown implementation failures', () => {
    expect(
      toExpectedFileSearchIoError(
        root,
        Object.assign(new Error('constraint failed'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 19,
        }),
        'fallback'
      )
    ).toBeUndefined();
    expect(toExpectedFileSearchIoError(root, new Error('bug'), 'fallback')).toBeUndefined();
  });

  it('maps root access precisely and treats watcher attachment as operational', () => {
    expect(
      toExpectedRootAccessError(root, Object.assign(new Error('denied'), { code: 'EACCES' }))
    ).toMatchObject({ type: 'root-unavailable', reason: 'permission-denied' });
    expect(
      toExpectedPathIndexError(
        root,
        new RootWatchError(
          'File-search watcher could not attach to the root',
          new Error('watch backend unavailable')
        ),
        'fallback'
      )
    ).toMatchObject({ type: 'io', message: 'watch backend unavailable' });
    expect(
      toExpectedPathIndexError(
        root,
        new RootWatchError(
          'File-search watcher could not be created for the root',
          new Error('watch construction failed')
        ),
        'fallback'
      )
    ).toMatchObject({ type: 'io', message: 'watch construction failed' });
    expect(
      toExpectedRootError(
        root,
        new RootWatchError(
          'File-search watcher could not be created for the root',
          new Error('watch construction failed')
        ),
        'fallback'
      )
    ).toMatchObject({ type: 'io', message: 'watch construction failed' });
  });
});
