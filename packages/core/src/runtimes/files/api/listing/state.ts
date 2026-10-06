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
 * One child of a listed folder, keyed by its name in the listing. Entries
 * carry identity only (kind and link target); size and timestamps would turn
 * every save into a listing change.
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
 * The live listing of one folder: its children by name, or why it cannot be
 * listed. A folder that disappears while observed turns into an error and
 * recovers when it is recreated.
 */
export const folderListingSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    entries: z.record(z.string(), listingEntrySchema),
  }),
  z.object({ status: z.literal('error'), error: fsErrorSchema }),
]);

export type ListingEntryKind = z.infer<typeof listingEntryKindSchema>;
export type SymlinkTargetKind = z.infer<typeof symlinkTargetKindSchema>;
export type ListingEntry = z.infer<typeof listingEntrySchema>;
export type FolderListing = z.infer<typeof folderListingSchema>;

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
