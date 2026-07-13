import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import { gitContract, type GitContract } from '@runtimes/git/api';
import type { GitRuntime } from '@runtimes/git/node/git-runtime';
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
