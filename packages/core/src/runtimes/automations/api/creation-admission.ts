import { defineContract, fallible } from '@emdash/wire/rpc';
import { z } from 'zod';

/**
 * Tombstone-aware creation admission for automation runs (ADR 0006, spec §4).
 * Deletion tombstones live on the client's workspace mirror, not on the host
 * registry, so the automations runtime cannot read them itself: the embedding app
 * supplies this contract as a component dependency. The desktop implements it as a
 * data check against its mirror; hosts without a mirror (the workspace server)
 * admit unconditionally — they cannot know client-side intent, and identity-keyed
 * deletion keeps recreation safe regardless.
 */

export const workspaceCreationRefusalSchema = z.object({
  type: z.literal('workspace-tombstone-pending'),
  workspaceId: z.string(),
  message: z.string(),
});

export const workspaceCreationAdmissionContract = defineContract({
  /**
   * Refuses when the requested worktree path or branch carries a pending deletion
   * tombstone — the same branch + path admission task creation performs. Checked
   * before the run's `createWorktree` call; the refusal lands on the run record as
   * its typed error.
   */
  checkWorktreeCreation: fallible({
    input: z.object({ path: z.string(), branch: z.string() }),
    data: z.void(),
    error: workspaceCreationRefusalSchema,
  }),
});

export type WorkspaceCreationAdmissionContract = typeof workspaceCreationAdmissionContract;
export type WorkspaceCreationRefusal = z.infer<typeof workspaceCreationRefusalSchema>;
