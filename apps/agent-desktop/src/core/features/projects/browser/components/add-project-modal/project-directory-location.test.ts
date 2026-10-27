import { describe, expect, it } from 'vitest';
import { projectDirectoryLocation } from './project-directory-location';

describe('projectDirectoryLocation', () => {
  it.each([
    ['/srv/projects/agent', '/', '/'],
    [String.raw`D:\Projects\agent`, 'D:\\', '\\'],
    [String.raw`\\server\share\Projects\agent`, String.raw`\\server\share`, '\\'],
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
