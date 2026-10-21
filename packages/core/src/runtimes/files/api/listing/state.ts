import { z } from 'zod';
import { fsErrorSchema } from '#runtimes/files/api/errors';

export const listingEntryKindSchema = z.enum(['file', 'directory', 'symlink']);
export const symlinkTargetKindSchema = z.enum([
  'file',
  'directory',
  'other',
  'missing',
  'outside-root',
]);

/**
 * One child of a listed folder. Entries carry identity only (kind and link
 * target); size and timestamps would turn every save into a listing change.
 */
export const listingEntrySchema = z
  .object({
    kind: listingEntryKindSchema,
    symlinkTarget: z.string().nullable().optional(),
    symlinkTargetKind: symlinkTargetKindSchema.optional(),
    symlinkTargetOutsideRoot: z.boolean().optional(),
  })
  .superRefine((entry, context) => {
    if ((entry.kind === 'symlink') !== (entry.symlinkTargetKind !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['symlinkTargetKind'],
        message: 'Exactly the symlink entries describe a symlink target kind',
      });
    }
  });

/**
 * A child's key in a listing: its name behind a `/`. File names are arbitrary
 * strings, so a bare name can be a key JavaScript objects reserve (`__proto__`),
 * which assignment, JSON patches and Immer drafts cannot hold as an own
 * property. No file name contains `/` and no reserved key starts with it, so
 * every child is an ordinary property wherever the listing travels.
 */
export const listingEntryKeySchema = z.templateLiteral(['/', z.string()]);

/**
 * The live listing of one folder: its children by key, or why it cannot be
 * listed. A folder that disappears while observed turns into an error and
 * recovers when it is recreated.
 */
export const folderListingSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    entries: z.record(listingEntryKeySchema, listingEntrySchema),
  }),
  z.object({ status: z.literal('error'), error: fsErrorSchema }),
]);

export type ListingEntryKind = z.infer<typeof listingEntryKindSchema>;
export type SymlinkTargetKind = z.infer<typeof symlinkTargetKindSchema>;
export type ListingEntry = z.infer<typeof listingEntrySchema>;
export type FolderListing = z.infer<typeof folderListingSchema>;
export type ListingEntryKey = z.infer<typeof listingEntryKeySchema>;
export type ListingEntries = Extract<FolderListing, { status: 'ready' }>['entries'];

export function listingEntryKey(name: string): ListingEntryKey {
  return `/${name}`;
}

export function listingEntryName(key: string): string {
  return key.slice(1);
}

export function listingEntry(
  entries: Readonly<ListingEntries>,
  name: string
): ListingEntry | undefined {
  return entries[listingEntryKey(name)];
}

export function isExpandableListingEntry(
  entry: Pick<ListingEntry, 'kind' | 'symlinkTargetKind'>
): boolean {
  return (
    entry.kind === 'directory' ||
    (entry.kind === 'symlink' && entry.symlinkTargetKind === 'directory')
  );
}

export function isOpenableListingEntry(
  entry: Pick<ListingEntry, 'kind' | 'symlinkTargetKind'>
): boolean {
  return entry.kind === 'file' || (entry.kind === 'symlink' && entry.symlinkTargetKind === 'file');
}
