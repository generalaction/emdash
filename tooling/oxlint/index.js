import { coreModuleBoundariesRule } from './rules/core-module-boundaries.js';
import { noToolingImportsRule } from './rules/no-tooling-imports.js';

export default {
  meta: {
    name: 'emdash',
  },
  rules: {
    'core-module-boundaries': coreModuleBoundariesRule,
    'no-tooling-imports': noToolingImportsRule,
  },
};
