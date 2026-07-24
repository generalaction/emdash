import type { ValidatePolicy } from '../api/with-validation';

export function workerValidatePolicy(env: NodeJS.ProcessEnv = process.env): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}
