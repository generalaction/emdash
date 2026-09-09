import { describe, expect, it } from 'vitest';
import { projectDirectoryLocation } from './project-directory-location';

describe('projectDirectoryLocation', () => {
  it.each([
    ['/srv/projects/emdash', '/', '/'],
    [String.raw`D:\Projects\emdash`, 'D:\\', '\\'],
    [String.raw`\\server\share\Projects\emdash`, String.raw`\\server\share`, '\\'],
  ] as const)(
    'keeps %s on its own navigable filesystem root',
    (path, navigationRoot, separator) => {
      expect(projectDirectoryLocation(path)).toMatchObject({ navigationRoot, separator });
    }
  );

  it('rejects a drive-relative location', () => {
    expect(projectDirectoryLocation('D:Projects')).toBeNull();
  });
});
