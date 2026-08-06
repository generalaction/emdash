import { coreHostBoundariesRule } from './rules/core-host-boundaries.js';
import { coreModuleBoundariesRule } from './rules/core-module-boundaries.js';
import { noDynamicImportsRule } from './rules/no-dynamic-imports.js';
import { noLegacyUiKitRule } from './rules/no-legacy-ui-kit.js';
import { noToolingImportsRule } from './rules/no-tooling-imports.js';

export default {
  meta: {
    name: 'emdash',
  },
  rules: {
    'core-host-boundaries': coreHostBoundariesRule,
    'core-module-boundaries': coreModuleBoundariesRule,
    'no-dynamic-imports': noDynamicImportsRule,
    'no-legacy-ui-kit': noLegacyUiKitRule,
    'no-tooling-imports': noToolingImportsRule,
  },
};
