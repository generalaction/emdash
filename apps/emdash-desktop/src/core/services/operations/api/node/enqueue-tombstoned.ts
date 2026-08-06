import type { AnyOperationDefinition, InputOf } from '@emdash/core/primitives/kernel/api';
import type { OperationMutationError } from '@emdash/core/primitives/operations/api';
import type { Result } from '@emdash/shared';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationMutationResult } from '@core/services/operations/node/definition';

export type OperationMutation = Result<OperationMutationResult, OperationMutationError>;

export interface OperationSubmitter {
  readonly db: AppDb;
  submit<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<OperationMutation>;
}
