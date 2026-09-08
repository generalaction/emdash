import {
  createStylingReporter,
  getFilename,
  getStylingOptions,
  importSource,
  isStylingCssTsFile,
  propertyName,
  stylingRuleMeta,
} from './styling-rule-utils.js';

const UTILITY_PROPERTIES = new Set([
  'alignItems',
  'alignSelf',
  'background',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderBottomWidth',
  'borderColor',
  'borderLeftWidth',
  'borderRadius',
  'borderRightWidth',
  'borderStyle',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderTopWidth',
  'borderWidth',
  'bottom',
  'boxShadow',
  'color',
  'columnGap',
  'cursor',
  'display',
  'flex',
  'flexDirection',
  'flexGrow',
  'flexShrink',
  'flexWrap',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'gap',
  'height',
  'inset',
  'justifyContent',
  'justifySelf',
  'left',
  'lineHeight',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'mx',
  'my',
  'opacity',
  'outlineColor',
  'overflow',
  'overflowX',
  'overflowY',
  'p',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'pointerEvents',
  'position',
  'px',
  'py',
  'right',
  'rounded',
  'roundedBottom',
  'roundedLeft',
  'roundedRight',
  'roundedTop',
  'rowGap',
  'shrink',
  'textAlign',
  'textDecoration',
  'textOverflow',
  'textTransform',
  'top',
  'userSelect',
  'visibility',
  'whiteSpace',
  'width',
  'wordBreak',
  'zIndex',
]);

const CONTAINER_KEYS = new Set([
  '@container',
  '@layer',
  '@media',
  '@supports',
  'base',
  'compoundVariants',
  'selectors',
  'variants',
]);

const EXPANSIONS = {
  background: ['background-color', 'background-image'],
  borderColor: [
    'border-bottom-color',
    'border-left-color',
    'border-right-color',
    'border-top-color',
  ],
  borderRadius: [
    'border-bottom-left-radius',
    'border-bottom-right-radius',
    'border-top-left-radius',
    'border-top-right-radius',
  ],
  borderStyle: [
    'border-bottom-style',
    'border-left-style',
    'border-right-style',
    'border-top-style',
  ],
  borderWidth: [
    'border-bottom-width',
    'border-left-width',
    'border-right-width',
    'border-top-width',
  ],
  flex: ['flex-basis', 'flex-grow', 'flex-shrink'],
  inset: ['bottom', 'left', 'right', 'top'],
  mx: ['margin-left', 'margin-right'],
  my: ['margin-bottom', 'margin-top'],
  overflow: ['overflow-x', 'overflow-y'],
  p: ['padding-bottom', 'padding-left', 'padding-right', 'padding-top'],
  padding: ['padding-bottom', 'padding-left', 'padding-right', 'padding-top'],
  px: ['padding-left', 'padding-right'],
  py: ['padding-bottom', 'padding-top'],
  rounded: [
    'border-bottom-left-radius',
    'border-bottom-right-radius',
    'border-top-left-radius',
    'border-top-right-radius',
  ],
  roundedBottom: ['border-bottom-left-radius', 'border-bottom-right-radius'],
  roundedLeft: ['border-bottom-left-radius', 'border-top-left-radius'],
  roundedRight: ['border-bottom-right-radius', 'border-top-right-radius'],
  roundedTop: ['border-top-left-radius', 'border-top-right-radius'],
  shrink: ['flex-shrink'],
};

export const recipeUtilityConflictsRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    if (!isStylingCssTsFile(getFilename(context), options)) return {};
    const report = createStylingReporter(context, 'recipe-utility-conflicts', options);
    const styleFunctions = new Set();
    const recipeFunctions = new Set();
    const sxFunctions = new Set();

    return {
      ImportDeclaration(node) {
        const source = importSource(node);
        if (!source) return;
        for (const specifier of node.specifiers ?? []) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported = specifier.imported?.name ?? specifier.imported?.value;
          const local = specifier.local?.name;
          if (!local) continue;
          if (imported === 'style' || imported === 'hostStyle') styleFunctions.add(local);
          if (imported === 'recipe' || imported === 'hostRecipe') recipeFunctions.add(local);
          if (imported === 'sx') sxFunctions.add(local);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== 'Identifier') return;
        if (!styleFunctions.has(callee.name) && !recipeFunctions.has(callee.name)) return;
        const composition = node.arguments?.[0];
        if (!composition) return;

        const sxCalls = [];
        collectSxCalls(composition, sxFunctions, sxCalls);
        for (const sxCall of sxCalls) {
          const utility = analyzeSxCall(sxCall);
          const recipe = analyzeRecipeComposition(composition, sxCall);
          if (utility.dynamic || recipe.dynamic) {
            report(
              sxCall,
              'dynamic-composition',
              callee.name,
              'Recipe/Utility composition is dynamic, so lint cannot prove property ownership is disjoint.'
            );
            continue;
          }
          const conflicts = [...utility.properties]
            .filter((property) => recipe.properties.has(property))
            .sort((left, right) => left.localeCompare(right));
          if (conflicts.length === 0) continue;
          report(
            sxCall,
            'property-conflict',
            conflicts.join(','),
            `Style Utility and Recipe branches both own ${conflicts.join(', ')}. Keep one owner per canonical property.`
          );
        }
      },
    };
  },
};

function collectSxCalls(node, sxFunctions, result) {
  if (!node || typeof node !== 'object') return;
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    sxFunctions.has(node.callee.name)
  ) {
    result.push(node);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    if (Array.isArray(value)) {
      for (const item of value) collectSxCalls(item, sxFunctions, result);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      collectSxCalls(value, sxFunctions, result);
    }
  }
}

function analyzeSxCall(node) {
  const properties = new Set();
  const argument = node.arguments?.[0];
  if (argument?.type !== 'ObjectExpression') return { dynamic: true, properties };

  let dynamic = false;
  for (const property of argument.properties ?? []) {
    if (property.type === 'SpreadElement') {
      dynamic = true;
      continue;
    }
    const name = propertyName(property);
    if (!name || !UTILITY_PROPERTIES.has(name)) {
      dynamic = true;
      continue;
    }
    addCanonicalProperties(properties, name);
  }
  return { dynamic, properties };
}

function analyzeRecipeComposition(root, sxCall) {
  const state = { dynamic: false, properties: new Set() };
  visitComposition(root, sxCall, state, true);
  return state;
}

function visitComposition(node, sxCall, state, compositionPosition) {
  if (!node || node === sxCall) return;
  if (node.type === 'ArrayExpression') {
    for (const element of node.elements ?? []) {
      if (!element || element.type === 'SpreadElement') {
        state.dynamic = true;
      } else {
        visitComposition(element, sxCall, state, true);
      }
    }
    return;
  }
  if (node.type === 'ObjectExpression') {
    for (const property of node.properties ?? []) {
      if (property.type === 'SpreadElement') {
        state.dynamic = true;
        continue;
      }
      const name = propertyName(property);
      if (!name) {
        state.dynamic = true;
        continue;
      }
      if (name === 'defaultVariants') continue;
      if (UTILITY_PROPERTIES.has(name) || isRelatedCssProperty(name)) {
        addCanonicalProperties(state.properties, name);
        continue;
      }
      if (
        CONTAINER_KEYS.has(name) ||
        property.value?.type === 'ObjectExpression' ||
        property.value?.type === 'ArrayExpression'
      ) {
        visitComposition(property.value, sxCall, state, false);
      }
    }
    return;
  }
  if (compositionPosition) state.dynamic = true;
}

function addCanonicalProperties(target, name) {
  const expanded = EXPANSIONS[name];
  if (expanded) {
    for (const property of expanded) target.add(property);
    return;
  }
  target.add(toKebabCase(name));
}

function isRelatedCssProperty(name) {
  return (
    name === 'backgroundColor' ||
    name === 'flexBasis' ||
    name.startsWith('border') ||
    name.startsWith('margin') ||
    name.startsWith('overflow') ||
    name.startsWith('padding')
  );
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
