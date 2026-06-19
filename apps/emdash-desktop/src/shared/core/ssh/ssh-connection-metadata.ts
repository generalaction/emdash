import { normalizeSelection } from '@emdash/core/deps/runtime';
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

const installOverrideV2Schema = z.nullable(
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
  dependencySelections: z.record(z.string(), installOverrideV2Schema).optional(),
});

// ---------------------------------------------------------------------------
// v3 schema — adds 'pinned' kind to installOverrideSchema (pass-through migration)
// ---------------------------------------------------------------------------

const installOverrideV3Schema = z.nullable(
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('pinned'), realpath: z.string() }),
    z.object({ kind: z.literal('method'), method: z.string() }),
    z.object({ kind: z.literal('path'), path: z.string() }),
    z.object({ kind: z.literal('cli'), command: z.string() }),
  ])
);

const v3Schema = v0Schema.extend({
  /**
   * Per-agent installation override selections for this SSH host.
   * v3 adds { kind: 'pinned', realpath } to the override union.
   * Existing method/path/cli overrides remain valid unchanged.
   */
  dependencySelections: z.record(z.string(), installOverrideV3Schema).optional(),
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
 * v3: adds { kind: 'pinned', realpath } to installOverrideSchema (pass-through)
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
    const migratedSelections: Record<string, z.infer<typeof installOverrideV2Schema>> = {};
    for (const [depId, raw] of entries) {
      // Legacy selections never contain 'pinned'; safe to cast to v2 type.
      migratedSelections[depId] = normalizeSelection(raw) as z.infer<
        typeof installOverrideV2Schema
      >;
    }
    return {
      ...prev,
      version: '2',
      dependencySelections: migratedSelections,
    };
  })
  .version('3', v3Schema, (prev) => ({
    // Pass-through: existing method/path/cli overrides are valid in v3.
    // New 'pinned' overrides can only be created going forward.
    ...prev,
    version: '3',
  }))
  .build();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** The TypeScript type for SSH connection metadata. */
export type SshConnectionMetadata = typeof sshConnectionMetadata.Type;
