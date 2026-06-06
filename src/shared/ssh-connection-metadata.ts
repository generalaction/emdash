import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema';

// ---------------------------------------------------------------------------
// v0 schema — unversioned legacy format
// ---------------------------------------------------------------------------

const v0Schema = z.object({
  sshConfigAlias: z.string().optional(),
  forwardAgent: z.boolean().optional(),
  proxyJump: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Versioned schema
// ---------------------------------------------------------------------------

/**
 * Versioned schema for SSH connection metadata stored in `sshConnections.metadata`.
 *
 * The stored object is intentionally small: only fields that cannot be captured
 * in dedicated DB columns live here (sshConfigAlias, forwardAgent, proxyJump).
 * Unknown keys (e.g. legacy `worktreesDir`) are silently stripped on read.
 */
export const sshConnectionMetadata = defineVersionedSchema().unversioned(v0Schema).build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The TypeScript type for SSH connection metadata. */
export type SshConnectionMetadata = typeof sshConnectionMetadata.Type;
