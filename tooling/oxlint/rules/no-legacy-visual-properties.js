import {
  createStylingReporter,
  getFilename,
  getStylingOptions,
  isStylingCssTsFile,
  stylingRuleMeta,
} from './styling-rule-utils.js';

const CUSTOM_PROPERTY_PATTERN = /--[A-Za-z_][A-Za-z0-9_-]*/g;

export const noLegacyVisualPropertiesRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    if (!isStylingCssTsFile(getFilename(context), options)) return {};
    const report = createStylingReporter(context, 'no-legacy-visual-properties', options);

    function check(node, value) {
      const customProperties = new Set(value.match(CUSTOM_PROPERTY_PATTERN) ?? []);
      for (const property of customProperties) {
        if (property.startsWith('--em-') || property.startsWith('--_')) continue;
        report(
          node,
          'unprefixed-custom-property',
          property,
          `Legacy author-facing visual property '${property}' is not namespaced; use a canonical --em-* Token Value or a --_ module-local variable.`
        );
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        const value = node.value?.raw ?? node.value?.cooked;
        if (typeof value === 'string') check(node, value);
      },
    };
  },
};
