import {
  createStylingReporter,
  getFilename,
  getStylingOptions,
  importSource,
  isRegisteredModule,
  isStylingCssTsFile,
  literalValue,
  loadRegistryModules,
  stylingRuleMeta,
} from './styling-rule-utils.js';

const GLOBAL_STYLE_IMPORTS = new Set([
  '@emdash/ui/styles',
  '@styles/index',
  '@styles/adapter',
  '@vanilla-extract/css',
]);

export const rootedGlobalAdaptersRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    const filename = getFilename(context);
    if (!isStylingCssTsFile(filename, options)) return {};
    const report = createStylingReporter(context, 'rooted-global-adapters', options);
    const adapterModules = loadRegistryModules('global-adapters', options);
    const isAdapter = isRegisteredModule(filename, adapterModules, options);
    const globalStyleFunctions = new Set();

    return {
      ImportDeclaration(node) {
        if (!GLOBAL_STYLE_IMPORTS.has(importSource(node))) return;
        for (const specifier of node.specifiers ?? []) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported = specifier.imported?.name ?? specifier.imported?.value;
          if (imported === 'globalStyle' && specifier.local?.name) {
            globalStyleFunctions.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        if (node.callee?.type !== 'Identifier' || !globalStyleFunctions.has(node.callee.name)) {
          return;
        }
        const selector = node.arguments?.[0];
        const detail = selectorIdentity(selector);
        if (selectorContainsSvg(selector)) {
          if (isAdapter && isRootedDirectChildSvg(selector)) return;
          report(
            node,
            'ad-hoc-svg',
            detail,
            'Owned SVG descendants must use Icon/IconSlot; an ad hoc SVG Global Rule is not allowed.'
          );
          return;
        }
        if (!isAdapter) {
          report(
            node,
            'outside-adapter',
            detail,
            'Global Rules may only be authored in a declared Global Adapter module.'
          );
          return;
        }
        if (!isRootedSelector(selector)) {
          report(
            node,
            'unrooted-adapter',
            detail,
            'Global Adapter selectors must be statically rooted in the Adapter-owned generated class.'
          );
        }
      },
    };
  },
};

function selectorContainsSvg(node) {
  return /\bsvg\b/i.test(selectorIdentity(node));
}

function isRootedSelector(node) {
  if (node?.type !== 'TemplateLiteral') return false;
  if ((node.expressions?.length ?? 0) < 1 || node.quasis?.[0]?.value?.raw !== '') return false;
  if (node.expressions[0]?.type !== 'Identifier') return false;
  const suffix = node.quasis?.[1]?.value?.raw ?? '';
  return /^\s*(?:>|\+|~|\[|:|\.)/.test(suffix) || /^\s+/.test(suffix);
}

function isRootedDirectChildSvg(node) {
  if (!isRootedSelector(node) || node.expressions.length !== 1) return false;
  const suffix = node.quasis?.[1]?.value?.raw ?? '';
  return /^\s*>\s*svg\s*$/.test(suffix);
}

function selectorIdentity(node) {
  const literal = literalValue(node);
  if (literal !== undefined) return literal;
  if (node?.type === 'Identifier') return `<dynamic:${node.name}>`;
  if (node?.type !== 'TemplateLiteral') return '<dynamic>';

  let value = node.quasis?.[0]?.value?.raw ?? '';
  for (let index = 0; index < (node.expressions?.length ?? 0); index += 1) {
    const expression = node.expressions[index];
    value += `\${${expression?.type === 'Identifier' ? expression.name : '?'}}`;
    value += node.quasis?.[index + 1]?.value?.raw ?? '';
  }
  return value.replace(/\s+/g, ' ').trim();
}
