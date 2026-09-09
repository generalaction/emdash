import {
  createStylingReporter,
  getFilename,
  getStylingOptions,
  isRegisteredModule,
  isStylingCssTsFile,
  isUiFile,
  loadRegistryModules,
  propertyName,
  stylingRuleMeta,
} from './styling-rule-utils.js';

export const stylingLayerBoundariesRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    const filename = getFilename(context);
    if (!isUiFile(filename, options) && !isStylingCssTsFile(filename, options)) return {};
    const infrastructureModules = loadRegistryModules('styling-infrastructure', options);
    if (isRegisteredModule(filename, infrastructureModules, options)) return {};
    const report = createStylingReporter(context, 'styling-layer-boundaries', options);

    return {
      Property(node) {
        if (propertyName(node) !== '@layer') return;
        report(
          node,
          'manual-layer',
          '@layer',
          'Styling callers must not select a cascade layer; use the layer-aware Style Recipe or Utility interface.'
        );
      },
      CallExpression(node) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'globalLayer') return;
        report(
          node,
          'manual-layer',
          'globalLayer',
          'Styling callers must not create cascade layers; the canonical prelude owns layer declaration.'
        );
      },
    };
  },
};
