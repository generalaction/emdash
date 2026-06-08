import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

// ---------------------------------------------------------------------------
// v0 schema — unversioned legacy format stored in workspaces.data
// ---------------------------------------------------------------------------

const v0Schema = z.object({
  type: z.literal('script'),
  provisionCommand: z.string(),
  terminateCommand: z.string(),
  remoteWorkspaceId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Versioned schema
// ---------------------------------------------------------------------------

/**
 * Versioned schema for BYOI workspace provider data stored in `workspaces.data`.
 *
 * Written once after a successful BYOI provision script run. The data captures
 * the connection commands and optional remote workspace ID so the session can
 * be reused on subsequent launches.
 */
export const workspaceProviderData = defineVersionedSchema().unversioned(v0Schema).build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The TypeScript type for BYOI workspace provider data. */
export type WorkspaceProviderData = typeof workspaceProviderData.Type;
