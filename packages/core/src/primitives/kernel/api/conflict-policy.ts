import type { AnyOperationDefinition } from './definition';

export type ConflictResolution = 'dedupe' | 'reject' | 'supersede' | 'queue';

export interface ConflictPolicy {
  readonly entries: ReadonlyMap<
    AnyOperationDefinition,
    ReadonlyMap<AnyOperationDefinition, ConflictResolution>
  >;
  resolve(incoming: AnyOperationDefinition, existing: AnyOperationDefinition): ConflictResolution;
  resolveNames(incomingName: string, existingName: string): ConflictResolution;
  hasExplicit(incomingName: string, existingName: string): boolean;
}

type MutablePolicyMap = Map<
  AnyOperationDefinition,
  Map<AnyOperationDefinition, ConflictResolution>
>;

export function defineConflictPolicy(
  build: (on: ConflictPolicyBuilder['on']) => void
): ConflictPolicy {
  const entries: MutablePolicyMap = new Map();
  const builder = new ConflictPolicyBuilder(entries);
  build(builder.on);
  return createConflictPolicy(entries);
}

export function mergeConflictPolicies(policies: readonly ConflictPolicy[]): ConflictPolicy {
  const merged: MutablePolicyMap = new Map();

  for (const policy of policies) {
    for (const [incoming, existingRows] of policy.entries) {
      const rows = merged.get(incoming) ?? new Map();
      for (const [existing, resolution] of existingRows) {
        if (rows.has(existing)) {
          throw new Error(
            `Duplicate conflict policy for incoming '${incoming.name}' and existing '${existing.name}'`
          );
        }
        rows.set(existing, resolution);
      }
      merged.set(incoming, rows);
    }
  }

  return createConflictPolicy(merged);
}

export function resolveConflict(
  policy: ConflictPolicy,
  incoming: AnyOperationDefinition,
  existing: AnyOperationDefinition
): ConflictResolution {
  return policy.resolve(incoming, existing);
}

class ConflictPolicyBuilder {
  constructor(private readonly entries: MutablePolicyMap) {}

  readonly on = (incoming: AnyOperationDefinition, existing: AnyOperationDefinition) => ({
    dedupe: () => this.set(incoming, existing, 'dedupe'),
    reject: () => this.set(incoming, existing, 'reject'),
    supersede: () => this.set(incoming, existing, 'supersede'),
    queue: () => this.set(incoming, existing, 'queue'),
  });

  private set(
    incoming: AnyOperationDefinition,
    existing: AnyOperationDefinition,
    resolution: ConflictResolution
  ): void {
    const rows = this.entries.get(incoming) ?? new Map();
    if (rows.has(existing)) {
      throw new Error(
        `Duplicate conflict policy for incoming '${incoming.name}' and existing '${existing.name}'`
      );
    }
    rows.set(existing, resolution);
    this.entries.set(incoming, rows);
  }
}

function createConflictPolicy(entries: MutablePolicyMap): ConflictPolicy {
  const frozenEntries = new Map<
    AnyOperationDefinition,
    ReadonlyMap<AnyOperationDefinition, ConflictResolution>
  >();
  const byName = new Map<string, Map<string, ConflictResolution>>();
  for (const [incoming, rows] of entries) {
    frozenEntries.set(incoming, new Map(rows));
    const nameRows = byName.get(incoming.name) ?? new Map<string, ConflictResolution>();
    for (const [existing, resolution] of rows) {
      nameRows.set(existing.name, resolution);
    }
    byName.set(incoming.name, nameRows);
  }

  return Object.freeze({
    entries: frozenEntries,
    resolve(
      incoming: AnyOperationDefinition,
      existing: AnyOperationDefinition
    ): ConflictResolution {
      return frozenEntries.get(incoming)?.get(existing) ?? 'reject';
    },
    resolveNames(incomingName: string, existingName: string): ConflictResolution {
      return byName.get(incomingName)?.get(existingName) ?? 'reject';
    },
    hasExplicit(incomingName: string, existingName: string): boolean {
      return byName.get(incomingName)?.has(existingName) ?? false;
    },
  });
}
