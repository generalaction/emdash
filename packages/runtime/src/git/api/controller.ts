import { gitContract } from '@emdash/core/git';
import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { createGitContractAdapter } from './contract-adapter';

export type GitControllerOptions = {
  validate?: ValidatePolicy;
};

export function createGitController(
  runtime: GitRuntime,
  options: GitControllerOptions = {}
): Controller {
  const adapter = createGitContractAdapter(runtime);
  const controller = withValidation(
    gitContract,
    createController(gitContract, adapter.implementation),
    options.validate ?? 'inputs'
  );
  return {
    call: (path, input, meta) => controller.call(path, input, meta),
    resolveLive: (topic) => controller.resolveLive(topic),
    acquireLive: (topic) => controller.acquireLive(topic),
    dispose() {
      controller.dispose?.();
      void adapter.dispose();
    },
  };
}
