/**
 * Permission-request fixture helpers.
 *
 * `permissionItem` builds a ChatElicitation with the four standard ACP option
 * kinds (allow_once / allow_always / reject_once / reject_always) so stories
 * don't repeat this boilerplate.
 */

import type { ChatElicitation } from '@/model';

export type PermissionItemOptions = {
  id?: string;
  toolCallId?: string;
  /** Pre-formatted action verb. e.g. "Read a File", "Execute", "Write a File". */
  title: string;
};

/**
 * Returns a ChatElicitation with all four standard permission options.
 * The split-button defaults to "Allow once" (allow-once).
 */
export function permissionItem({
  id = 'perm-1',
  toolCallId,
  title,
}: PermissionItemOptions): ChatElicitation {
  return {
    kind: 'elicitation',
    id,
    variant: 'permission',
    toolCallId,
    title,
    defaultOptionId: 'allow-once',
    options: [
      { id: 'allow-once', label: 'Allow once', tone: 'accept' },
      { id: 'allow-always', label: 'Allow always', tone: 'accept' },
      { id: 'reject-once', label: 'Reject once', tone: 'reject' },
      { id: 'reject-always', label: 'Reject always', tone: 'reject' },
    ],
  };
}
