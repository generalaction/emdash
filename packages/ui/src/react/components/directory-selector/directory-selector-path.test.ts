import { describe, expect, it } from 'vitest';
import { splitDirectorySelectorPath } from './directory-selector';

describe('directory selector path parsing', () => {
  it('keeps a drive root attached to every Windows breadcrumb', () => {
    expect(splitDirectorySelectorPath(String.raw`D:\Projects\agent`, '\\')).toEqual([
      { label: 'D:', path: 'D:\\' },
      { label: 'Projects', path: String.raw`D:\Projects` },
      { label: 'agent', path: String.raw`D:\Projects\agent` },
    ]);
  });

  it('treats a UNC server and share as one filesystem root', () => {
    expect(splitDirectorySelectorPath(String.raw`\\server\share\Projects\agent`, '\\')).toEqual([
      { label: String.raw`\\server\share`, path: String.raw`\\server\share` },
      { label: 'Projects', path: String.raw`\\server\share\Projects` },
      { label: 'agent', path: String.raw`\\server\share\Projects\agent` },
    ]);
  });
});
