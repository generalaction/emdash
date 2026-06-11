import z from 'zod';
import { hostDependencySelectionSchema } from '@shared/core/dependencies';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

// ---------------------------------------------------------------------------
// v0 schema — unversioned legacy format
// ---------------------------------------------------------------------------

const v0Schema = z.object({
  sshConfigAlias: z.string().optional(),
  forwardAgent: z.boolean().optional(),
  proxyJump: z.string().optional(),
});

// ---------------------------------------------------------------------------
// v1 schema — adds per-agent host-scoped dependency selections
// ---------------------------------------------------------------------------

const v1Schema = v0Schema.extend({
  /**
   * Per-agent installation selections for this SSH host.
   * Keys are DependencyId (agent provider IDs); values are the user's choice.
   */
  dependencySelections: z.record(z.string(), hostDependencySelectionSchema).optional(),
});

// ---------------------------------------------------------------------------
// Versioned schema
// ---------------------------------------------------------------------------

/**
 * Versioned schema for SSH connection metadata stored in `sshConnections.metadata`.
 *
 * The stored object is intentionally small: only fields that cannot be captured
 * in dedicated DB columns live here.
 *
 * v0 (unversioned): sshConfigAlias, forwardAgent, proxyJump
 * v1: adds dependencySelections for per-agent host-scoped install preferences
 */
export const sshConnectionMetadata = defineVersionedSchema()
  .unversioned(v0Schema)
  .version('1', v1Schema, (prev) => ({ ...prev, version: '1' }))
  .build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The TypeScript type for SSH connection metadata. */
export type SshConnectionMetadata = typeof sshConnectionMetadata.Type;
