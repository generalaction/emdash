import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import { fileSearchContract, type FileSearchContract } from '@runtimes/file-search/api';
import { createFileSearchProcedures, type FileSearchRuntimeApi } from './procedures';

export type FileSearchControllerOptions = {
  contract?: FileSearchContract;
  validate?: ValidatePolicy;
};

export function createFileSearchController(
  runtime: FileSearchRuntimeApi,
  options: FileSearchControllerOptions = {}
): Controller {
  const contract = options.contract ?? fileSearchContract;
  return withValidation(
    contract,
    createController(contract, createFileSearchProcedures(runtime)),
    options.validate ?? 'inputs'
  );
}
