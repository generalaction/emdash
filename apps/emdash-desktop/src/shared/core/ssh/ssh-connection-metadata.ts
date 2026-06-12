import { normalizeSelection } from '@emdash/shared/deps/runtime';
import z from 'zod';
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
// v1 schema — adds per-agent host-scoped dependency selections (legacy format)
// ---------------------------------------------------------------------------

const legacyHostDependencySelectionSchema = z.object({
  usedId: z.string().optional(),
  path: z.string().optional(),
  cli: z.string().optional(),
});

const v1Schema = v0Schema.extend({
  /**
   * Per-agent installation selections (legacy {usedId?,path?,cli?} format).
   * Keys are DependencyId; values are the user's choice.
   */
  dependencySelections: z.record(z.string(), legacyHostDependencySelectionSchema).optional(),
});

// ---------------------------------------------------------------------------
// v2 schema — InstallOverride | null per agent (override-only; null = auto)
// ---------------------------------------------------------------------------

const installOverrideSchema = z.nullable(
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('method'), method: z.string() }),
    z.object({ kind: z.literal('path'), path: z.string() }),
    z.object({ kind: z.literal('cli'), command: z.string() }),
  ])
);

const v2Schema = v0Schema.extend({
  /**
   * Per-agent installation override selections for this SSH host.
   * Keys are DependencyId; null value means auto (no override).
   *
   * v2 format: InstallOverride | null (discriminated union or null).
   */
  dependencySelections: z.record(z.string(), installOverrideSchema).optional(),
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
 * v1: adds dependencySelections ({usedId?,path?,cli?} legacy format)
 * v2: migrates dependencySelections to InstallOverride | null (override-only)
 */
export const sshConnectionMetadata = defineVersionedSchema()
  .unversioned(v0Schema)
  .version('1', v1Schema, (prev) => ({ ...prev, version: '1' }))
  .version('2', v2Schema, (prev) => {
    const legacySelections = prev.dependencySelections ?? {};
    const entries = Object.entries(legacySelections);
    if (entries.length === 0) {
      const { dependencySelections: _omit, ...rest } = prev;
      return { ...rest, version: '2' };
    }
    const migratedSelections: Record<string, z.infer<typeof installOverrideSchema>> = {};
    for (const [depId, raw] of entries) {
      migratedSelections[depId] = normalizeSelection(raw);
    }
    return {
      ...prev,
      version: '2',
      dependencySelections: migratedSelections,
    };
  })
  .build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The TypeScript type for SSH connection metadata. */
export type SshConnectionMetadata = typeof sshConnectionMetadata.Type;
