import { gitContract, type GitContract } from '@emdash/core/git';
import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { createGitProcedures } from './procedures';

export type GitControllerOptions = {
  contract?: GitContract;
  validate?: ValidatePolicy;
};

export function createGitController(
  runtime: GitRuntime,
  options: GitControllerOptions = {}
): Controller {
  const contract = options.contract ?? gitContract;
  return withValidation(
    contract,
    createController(contract, createGitProcedures(runtime, contract)),
    options.validate ?? 'inputs'
  );
}
