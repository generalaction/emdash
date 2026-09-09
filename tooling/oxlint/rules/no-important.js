import {
  createStylingReporter,
  getFilename,
  getStylingOptions,
  isStylingCssTsFile,
  stylingRuleMeta,
} from './styling-rule-utils.js';

export const noImportantRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    if (!isStylingCssTsFile(getFilename(context), options)) return {};
    const report = createStylingReporter(context, 'no-important', options);

    function check(node, value) {
      if (!/!\s*important\b/i.test(value)) return;
      report(
        node,
        'important',
        '!important',
        'CSS-in-TypeScript must not use !important; expose an owning Recipe variant or Utility override.'
      );
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
