import { filesContract, type FilesContract } from '@emdash/core/files';
import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import type { FilesRuntime } from '../files-runtime';
import { createFilesProcedures } from './procedures';

export type FilesControllerOptions = {
  contract?: FilesContract;
  validate?: ValidatePolicy;
};

export function createFilesController(
  runtime: FilesRuntime,
  options: FilesControllerOptions = {}
): Controller {
  const contract = options.contract ?? filesContract;
  return withValidation(
    contract,
    createController(contract, createFilesProcedures(runtime, contract)),
    options.validate ?? 'inputs'
  );
}
