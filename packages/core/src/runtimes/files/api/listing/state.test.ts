import { describe, expect, it } from 'vitest';
import {
  folderListingSchema,
  isExpandableListingEntry,
  isOpenableListingEntry,
  listingEntrySchema,
} from './state';

describe('folder listing state', () => {
  it('lists children by name with their kinds', () => {
    const listing = {
      status: 'ready' as const,
      entries: {
        src: { kind: 'directory' as const },
        'README.md': { kind: 'file' as const },
        linked: {
          kind: 'symlink' as const,
          symlinkTarget: '../shared',
          symlinkTargetKind: 'directory' as const,
          symlinkTargetOutsideRoot: true,
        },
      },
    };
    expect(folderListingSchema.parse(listing)).toEqual(listing);
  });

  it('describes a folder that cannot be listed', () => {
    const listing = {
      status: 'error' as const,
      error: { type: 'not-found' as const, path: 'gone' },
    };
    expect(folderListingSchema.parse(listing)).toEqual(listing);
  });

  it('requires a target kind on exactly the symlink entries', () => {
    expect(listingEntrySchema.safeParse({ kind: 'symlink' }).success).toBe(false);
    expect(listingEntrySchema.safeParse({ kind: 'file', symlinkTargetKind: 'file' }).success).toBe(
      false
    );
  });

  it('treats folders and links to folders as expandable, files and links to files as openable', () => {
    expect(isExpandableListingEntry({ kind: 'directory' })).toBe(true);
    expect(isExpandableListingEntry({ kind: 'symlink', symlinkTargetKind: 'directory' })).toBe(
      true
    );
    expect(isExpandableListingEntry({ kind: 'symlink', symlinkTargetKind: 'missing' })).toBe(false);
    expect(isOpenableListingEntry({ kind: 'file' })).toBe(true);
    expect(isOpenableListingEntry({ kind: 'symlink', symlinkTargetKind: 'file' })).toBe(true);
    expect(isOpenableListingEntry({ kind: 'directory' })).toBe(false);
  });
});
