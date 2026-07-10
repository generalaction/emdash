import { gitContract } from '@emdash/core/git';
import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { createGitProcedures } from './procedures';

export type GitControllerOptions = {
  validate?: ValidatePolicy;
};

export function createGitController(
  runtime: GitRuntime,
  options: GitControllerOptions = {}
): Controller {
  const procedures = createGitProcedures(runtime);
  return withValidation(
    gitContract,
    createController(gitContract, procedures),
    options.validate ?? 'inputs'
  );
}
