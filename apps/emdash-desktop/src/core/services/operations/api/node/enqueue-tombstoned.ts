import type { AnyOperationDefinition, InputOf } from '@emdash/core/primitives/kernel/api';
import type { OperationMutationError } from '@emdash/core/primitives/operations/api';
import { err, type Result } from '@emdash/shared';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import type { OperationMutationResult } from '@core/services/operations/node/definition';

export type OperationMutation = Result<OperationMutationResult, OperationMutationError>;

export interface OperationSubmitter {
  readonly db: AppDb;
  submit<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<OperationMutation>;
}

export interface TombstoneEnqueueSpec<Row, D extends AnyOperationDefinition> {
  definition: D;
  load(): Row | undefined | Promise<Row | undefined>;
  notFound(): OperationMutationError;
  buildInput(row: Row): InputOf<D>;
  precondition?(tx: DrizzleTx, row: Row): OperationMutationError | undefined;
  tombstone(tx: DrizzleTx, row: Row): number;
  revert(tx: DrizzleTx, row: Row): void;
  poke?(row: Row, result: OperationMutationResult): void;
}

export async function enqueueTombstoned<Row, D extends AnyOperationDefinition>(
  submitter: OperationSubmitter,
  spec: TombstoneEnqueueSpec<Row, D>
): Promise<OperationMutation> {
  const row = await spec.load();
  if (row === undefined) return err(spec.notFound());

  // Compile before mutation: authoring mistakes must not leave a tombstone.
  const input = spec.buildInput(row);
  const preparationError = submitter.db.transaction((tx) => {
    const preconditionError = spec.precondition?.(tx, row);
    if (preconditionError) return preconditionError;
    if (spec.tombstone(tx, row) === 0) {
      return {
        type: 'operation-duplicate',
        message: 'Operation target is already tombstoned',
      };
    }
    return undefined;
  });
  if (preparationError) return err(preparationError);

  let submitted: OperationMutation;
  try {
    submitted = await submitter.submit(spec.definition, input);
  } catch (error) {
    submitter.db.transaction((tx) => spec.revert(tx, row));
    throw error;
  }
  if (!submitted.success) {
    submitter.db.transaction((tx) => spec.revert(tx, row));
    return submitted;
  }

  spec.poke?.(row, submitted.data);
  return submitted;
}
