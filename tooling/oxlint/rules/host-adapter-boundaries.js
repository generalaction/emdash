import {
  createStylingReporter,
  getFilename,
  getStylingOptions,
  importSource,
  isRegisteredModule,
  loadRegistryModules,
  stylingRuleMeta,
} from './styling-rule-utils.js';

const HOST_STYLES_ENTRY = '@emdash/ui/styles/host';

export const hostAdapterBoundariesRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    const filename = getFilename(context);
    const report = createStylingReporter(context, 'host-adapter-boundaries', options);
    const adapterModules = loadRegistryModules('host-adapters', options);

    function check(node) {
      const source = importSource(node);
      if (source !== HOST_STYLES_ENTRY && !source?.startsWith(`${HOST_STYLES_ENTRY}/`)) {
        return;
      }
      if (isRegisteredModule(filename, adapterModules, options)) return;
      report(
        node,
        'undeclared-host-adapter',
        source,
        `${source} may only be imported by a declared Host Styling Adapter module.`
      );
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
