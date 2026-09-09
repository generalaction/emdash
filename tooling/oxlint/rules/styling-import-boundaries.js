import path from 'node:path';
import {
  absoluteFilename,
  createStylingReporter,
  getFilename,
  getStylingOptions,
  importSource,
  isRegisteredModule,
  isStylingCssTsFile,
  isUiFile,
  isWithin,
  loadRegistryModules,
  stylingRuleMeta,
} from './styling-rule-utils.js';

const VANILLA_EXTRACT_AUTHORING_IMPORTS = new Set([
  '@vanilla-extract/css',
  '@vanilla-extract/dynamic',
  '@vanilla-extract/recipes',
  '@vanilla-extract/sprinkles',
]);
const RETIRED_SETUP_IMPORTS = new Set([
  '@emdash/theme/semantic.css',
  '@emdash/theme/theme.css',
  '@emdash/ui/react/chat-ui/chat-theme.css',
  '@emdash/ui/style.css',
  '@emdash/ui/styles/base.css',
  '@emdash/ui/styles/effects.css',
  '@emdash/ui/styles/global',
  '@emdash/ui/styles/global-base.css',
  '@emdash/ui/styles/overflow-fade.css',
  '@emdash/ui/styles/tokens.css',
  '@emdash/ui/styles/typography.css',
]);

export const stylingImportBoundariesRule = {
  meta: stylingRuleMeta(),
  create(context) {
    const options = getStylingOptions(context);
    const filename = getFilename(context);
    const infrastructureModules = loadRegistryModules('styling-infrastructure', options);
    const isInfrastructure = isRegisteredModule(filename, infrastructureModules, options);
    const report = createStylingReporter(context, 'styling-import-boundaries', options);

    function check(node) {
      const specifier = importSource(node);
      if (!specifier) return;
      if (
        (isUiFile(filename, options) || isStylingCssTsFile(filename, options)) &&
        VANILLA_EXTRACT_AUTHORING_IMPORTS.has(specifier) &&
        !isInfrastructure
      ) {
        report(
          node,
          'direct-ve',
          specifier,
          `UI styling modules must use @emdash/ui/styles instead of the direct Vanilla Extract import '${specifier}'.`
        );
        return;
      }
      if (
        isUiFile(filename, options) &&
        isInternalAuthoringImport(specifier, filename, options) &&
        !isInfrastructure
      ) {
        report(
          node,
          'internal-interface',
          specifier,
          `UI styling modules must use @emdash/ui/styles instead of internal styling infrastructure '${specifier}'.`
        );
        return;
      }
      if (RETIRED_SETUP_IMPORTS.has(specifier)) {
        report(
          node,
          'retired-setup',
          specifier,
          `The retired styling setup import '${specifier}' must not be introduced; hosts load @emdash/ui/styles.css explicitly.`
        );
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

function isInternalAuthoringImport(specifier, filename, options) {
  if (specifier === '@styles/authoring' || specifier.startsWith('@styles/authoring/')) return true;
  if (!specifier.startsWith('.')) return false;
  const target = path.resolve(
    path.dirname(absoluteFilename(filename, options.repoRoot)),
    specifier
  );
  return isWithin(target, path.join(options.uiRoot, 'styles/authoring'));
}
