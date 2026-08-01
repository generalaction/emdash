import { modesCompatible } from './claim-modes';
import type { ConflictPolicy } from './conflict-policy';
import type { AnyOperationDefinition, InputOf } from './definition';
import type { OperationInitiator, OperationRecord, PropagationPolicy } from './record';
import type { ResourceClaim } from './resources';

export interface IncomingOperation {
  definition: AnyOperationDefinition;
  key: string;
  claims: ResourceClaim[];
  parentId?: string;
}

export type AdmissionDecision =
  | { kind: 'dedupe'; existing: OperationRecord }
  | { kind: 'reject'; conflicts: OperationRecord[] }
  | { kind: 'insert'; toSupersede: OperationRecord[] };

export function admit(
  incoming: IncomingOperation,
  nonTerminal: readonly OperationRecord[],
  policy: ConflictPolicy,
  byId: (id: string) => OperationRecord | undefined
): AdmissionDecision {
  const sameKey = nonTerminal.find((record) => record.key === incoming.key);
  if (sameKey) {
    if (sameKey.name !== incoming.definition.name) {
      return { kind: 'reject', conflicts: [sameKey] };
    }
    return { kind: 'dedupe', existing: sameKey };
  }

  const conflicts: OperationRecord[] = [];
  const toSupersede: OperationRecord[] = [];

  for (const existing of nonTerminal) {
    if (isAncestor(existing.id, incoming.parentId, byId)) {
      continue;
    }
    if (!claimsCollide(incoming.claims, existing.claims)) {
      continue;
    }

    const resolution = policy.resolveNames(incoming.definition.name, existing.name);
    if (resolution === 'reject') {
      conflicts.push(existing);
    } else if (resolution === 'supersede') {
      toSupersede.push(existing);
    }
  }

  if (conflicts.length > 0) {
    return { kind: 'reject', conflicts };
  }

  return { kind: 'insert', toSupersede };
}

export interface BatchMember<D extends AnyOperationDefinition = AnyOperationDefinition> {
  definition: D;
  input: InputOf<D>;
  parent?: number;
  adoptExisting?: boolean;
}

export interface BatchOptions {
  initiator: OperationInitiator;
  propagation?: PropagationPolicy;
}

export interface BatchAdmittedMember {
  index: number;
  definition: AnyOperationDefinition;
  input: unknown;
  key: string;
  claims: ResourceClaim[];
  parent?: number;
  adopted?: OperationRecord;
  dedupeOfIndex?: number;
}

export type BatchAdmissionDecision =
  | { kind: 'reject'; conflicts: OperationRecord[] }
  | {
      kind: 'insert';
      members: BatchAdmittedMember[];
      reparent: Array<{ id: string; parentIndex: number }>;
      toSupersede: OperationRecord[];
    };

export function admitBatch(
  members: readonly BatchMember[],
  nonTerminal: readonly OperationRecord[],
  policy: ConflictPolicy
): BatchAdmissionDecision {
  const admitted: BatchAdmittedMember[] = [];
  const visible: OperationRecord[] = [...nonTerminal];
  const placeholderByKey = new Map<string, number>();
  const adoptionParentByRecord = adoptionPlan(members, nonTerminal);
  const toSupersede = new Map<string, OperationRecord>();
  const reparent: Array<{ id: string; parentIndex: number }> = [];

  const byId = (id: string): OperationRecord | undefined =>
    visible.find((record) => record.id === id);

  for (const [index, member] of members.entries()) {
    validateBatchParent(member, index);
    const key = member.definition.key(member.input);
    const claims = member.definition.claims(member.input);
    const parentId = member.parent === undefined ? undefined : batchId(member.parent);
    const existingByKey = visible.find((record) => record.key === key);

    if (existingByKey) {
      if (existingByKey.name !== member.definition.name) {
        return { kind: 'reject', conflicts: [existingByKey] };
      }

      const placeholderIndex = placeholderByKey.get(key);
      if (placeholderIndex !== undefined && existingByKey.id === batchId(placeholderIndex)) {
        admitted.push({
          index,
          definition: member.definition,
          input: member.input,
          key,
          claims,
          parent: member.parent,
          dedupeOfIndex: placeholderIndex,
        });
        continue;
      }

      if (
        member.adoptExisting &&
        existingByKey.parentId === undefined &&
        member.parent !== undefined
      ) {
        reparent.push({ id: existingByKey.id, parentIndex: member.parent });
        admitted.push({
          index,
          definition: member.definition,
          input: member.input,
          key,
          claims,
          parent: member.parent,
          adopted: existingByKey,
        });
      } else {
        admitted.push({
          index,
          definition: member.definition,
          input: member.input,
          key,
          claims,
          parent: member.parent,
          adopted: existingByKey,
        });
      }
      continue;
    }

    const visibleForAdmission = visible.filter(
      (record) => !isPlannedAdoptionIntoSubtree(record, index, adoptionParentByRecord, members)
    );
    const decision = admit(
      { definition: member.definition, key, claims, parentId },
      visibleForAdmission,
      policy,
      byId
    );

    if (decision.kind === 'reject') {
      return { kind: 'reject', conflicts: decision.conflicts };
    }
    if (decision.kind === 'dedupe') {
      admitted.push({
        index,
        definition: member.definition,
        input: member.input,
        key,
        claims,
        parent: member.parent,
        adopted: decision.existing,
      });
      continue;
    }

    for (const record of decision.toSupersede) {
      toSupersede.set(record.id, record);
    }

    const placeholder = placeholderRecord(index, member.definition.name, key, claims, parentId);
    visible.push(placeholder);
    placeholderByKey.set(key, index);
    admitted.push({
      index,
      definition: member.definition,
      input: member.input,
      key,
      claims,
      parent: member.parent,
    });
  }

  return {
    kind: 'insert',
    members: admitted,
    reparent,
    toSupersede: [...toSupersede.values()],
  };
}

export function claimsCollide(
  incomingClaims: readonly ResourceClaim[],
  existingClaims: readonly ResourceClaim[]
): boolean {
  return incomingClaims.some((incoming) =>
    existingClaims.some(
      (existing) =>
        incoming.resource === existing.resource &&
        incoming.key === existing.key &&
        !modesCompatible(existing.mode, incoming.mode)
    )
  );
}

function validateBatchParent(member: BatchMember, index: number): void {
  if (member.parent === undefined) {
    return;
  }
  if (member.parent < 0 || member.parent >= index) {
    throw new Error(
      `Batch member ${index} references parent ${member.parent}; parents must appear earlier`
    );
  }
}

function adoptionPlan(
  members: readonly BatchMember[],
  nonTerminal: readonly OperationRecord[]
): Map<string, number> {
  const parentByRecord = new Map<string, number>();
  for (const member of members) {
    if (!member.adoptExisting || member.parent === undefined) {
      continue;
    }
    const key = member.definition.key(member.input);
    const existing = nonTerminal.find(
      (record) =>
        record.key === key &&
        record.name === member.definition.name &&
        record.parentId === undefined
    );
    if (existing) {
      parentByRecord.set(existing.id, member.parent);
    }
  }
  return parentByRecord;
}

function isPlannedAdoptionIntoSubtree(
  record: OperationRecord,
  ancestorIndex: number,
  adoptionParentByRecord: ReadonlyMap<string, number>,
  members: readonly BatchMember[]
): boolean {
  const parentIndex = adoptionParentByRecord.get(record.id);
  return parentIndex !== undefined && isBatchAncestor(ancestorIndex, parentIndex, members);
}

function isBatchAncestor(
  ancestorIndex: number,
  descendantIndex: number,
  members: readonly BatchMember[]
): boolean {
  let current: number | undefined = descendantIndex;
  while (current !== undefined) {
    if (current === ancestorIndex) {
      return true;
    }
    current = members[current]?.parent;
  }
  return false;
}

function isAncestor(
  candidateId: string,
  parentId: string | undefined,
  byId: (id: string) => OperationRecord | undefined
): boolean {
  let current = parentId;
  while (current) {
    if (current === candidateId) {
      return true;
    }
    current = byId(current)?.parentId;
  }
  return false;
}

function batchId(index: number): string {
  return `batch:${index}`;
}

function placeholderRecord(
  index: number,
  name: string,
  key: string,
  claims: ResourceClaim[],
  parentId: string | undefined
): OperationRecord {
  return {
    id: batchId(index),
    seq: Number.MAX_SAFE_INTEGER - index,
    name,
    key,
    input: undefined,
    claims,
    status: 'pending',
    attempt: 0,
    parentId,
    initiator: { kind: 'user', action: 'batch-placeholder' },
    createdAt: 0,
    updatedAt: 0,
  };
}
