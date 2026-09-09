import { coreHostBoundariesRule } from './rules/core-host-boundaries.js';
import { coreModuleBoundariesRule } from './rules/core-module-boundaries.js';
import { hostAdapterBoundariesRule } from './rules/host-adapter-boundaries.js';
import { noDynamicImportsRule } from './rules/no-dynamic-imports.js';
import { noImportantRule } from './rules/no-important.js';
import { noLegacyVisualPropertiesRule } from './rules/no-legacy-visual-properties.js';
import { noToolingImportsRule } from './rules/no-tooling-imports.js';
import { noTsxInApiRule } from './rules/no-tsx-in-api.js';
import { recipeUtilityConflictsRule } from './rules/recipe-utility-conflicts.js';
import { rootedGlobalAdaptersRule } from './rules/rooted-global-adapters.js';
import { stylingImportBoundariesRule } from './rules/styling-import-boundaries.js';
import { stylingLayerBoundariesRule } from './rules/styling-layer-boundaries.js';

export default {
  meta: {
    name: 'emdash',
  },
  rules: {
    'core-host-boundaries': coreHostBoundariesRule,
    'core-module-boundaries': coreModuleBoundariesRule,
    'host-adapter-boundaries': hostAdapterBoundariesRule,
    'no-important': noImportantRule,
    'no-legacy-visual-properties': noLegacyVisualPropertiesRule,
    'no-dynamic-imports': noDynamicImportsRule,
    'no-tooling-imports': noToolingImportsRule,
    'no-tsx-in-api': noTsxInApiRule,
    'recipe-utility-conflicts': recipeUtilityConflictsRule,
    'rooted-global-adapters': rootedGlobalAdaptersRule,
    'styling-import-boundaries': stylingImportBoundariesRule,
    'styling-layer-boundaries': stylingLayerBoundariesRule,
  },
};
