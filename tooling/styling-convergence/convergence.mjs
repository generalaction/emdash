const UI_STYLESHEET = '@emdash/ui/styles.css';
const RETIRED_STYLESHEETS = new Set([
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

export function findHostEntrypointProblems(source, hostStylesheet) {
  const imports = [...source.matchAll(/(?:\bimport|@import)\s+['"]([^'"]+)['"]/g)].map((match) => ({
    source: match[1],
    index: match.index,
  }));
  const problems = [];
  const uiImports = imports.filter((entry) => entry.source === UI_STYLESHEET);
  if (uiImports.length !== 1) {
    problems.push(`expected exactly one ${UI_STYLESHEET} import, found ${uiImports.length}`);
  }

  const hostImports = imports.filter((entry) => entry.source === hostStylesheet);
  if (hostImports.length !== 1) {
    problems.push(
      `expected exactly one host stylesheet import ${hostStylesheet}, found ${hostImports.length}`
    );
  }
  if (uiImports.length > 0 && hostImports.length > 0 && uiImports[0].index > hostImports[0].index) {
    problems.push(`${UI_STYLESHEET} must load before ${hostStylesheet}`);
  }
  for (const entry of imports) {
    if (RETIRED_STYLESHEETS.has(entry.source)) {
      problems.push(`retired stylesheet import remains: ${entry.source}`);
    }
  }
  return problems;
}

export function findHostLoaderProblems(source, hostEntrypoint) {
  const imports = [...source.matchAll(/\bimport\s+['"]([^'"]+\.css)['"]/g)].map(
    (match) => match[1]
  );
  const problems = [];
  const hostImports = imports.filter((specifier) => specifier === hostEntrypoint);
  if (hostImports.length !== 1) {
    problems.push(
      `expected exactly one plain-CSS host entry import ${hostEntrypoint}, found ${hostImports.length}`
    );
  }
  if (imports.includes(UI_STYLESHEET)) {
    problems.push(`TypeScript host loader must not import ${UI_STYLESHEET} directly`);
  }
  const additionalImports = imports
    .filter((specifier) => specifier !== hostEntrypoint && specifier !== UI_STYLESHEET)
    .sort(compareText);
  if (additionalImports.length > 0) {
    problems.push(
      `TypeScript host loader has additional CSS imports: ${additionalImports.join(', ')}`
    );
  }
  return problems;
}

export function findCssCompatibilityProblems({
  canonicalExport,
  canonicalTarget,
  cssExports,
  existingForbiddenFiles,
  retiredReferences,
}) {
  const problems = [];
  const exportPaths = Object.keys(cssExports).sort(compareText);
  if (exportPaths.length !== 1 || exportPaths[0] !== canonicalExport) {
    problems.push(
      `expected only public CSS export ${canonicalExport}, found ${exportPaths.join(', ') || '<none>'}`
    );
  }
  if (cssExports[canonicalExport] !== canonicalTarget) {
    problems.push(
      `expected ${canonicalExport} to target ${canonicalTarget}, found ${cssExports[canonicalExport] ?? '<none>'}`
    );
  }
  for (const file of existingForbiddenFiles) {
    problems.push(`retired CSS compatibility file remains: ${file}`);
  }
  for (const reference of retiredReferences) {
    problems.push(`retired CSS compatibility reference remains: ${reference}`);
  }
  return problems.sort(compareText);
}

export function findProfileParityMismatches(bootstrapClasses, providerClasses) {
  const combinations = new Set([...Object.keys(bootstrapClasses), ...Object.keys(providerClasses)]);
  const mismatches = [];
  for (const combination of [...combinations].sort(compareText)) {
    const bootstrap = bootstrapClasses[combination];
    const provider = providerClasses[combination];
    if (!bootstrap) {
      mismatches.push(`${combination}: missing bootstrap profile combination`);
      continue;
    }
    if (!provider) {
      mismatches.push(`${combination}: missing provider profile combination`);
      continue;
    }
    const normalizedBootstrap = [...bootstrap].sort(compareText);
    const normalizedProvider = [...provider].sort(compareText);
    if (arraysEqual(normalizedBootstrap, normalizedProvider)) continue;
    mismatches.push(
      `${combination}: bootstrap [${normalizedBootstrap.join(', ')}] != provider [${normalizedProvider.join(', ')}]`
    );
  }
  return mismatches;
}

export function findIntegrationCoverageGaps(manifest) {
  const gaps = [];
  for (const [field, definition] of Object.entries(manifest)) {
    for (const required of ['property', 'writer', 'reader', 'theme']) {
      if (typeof definition?.[required] === 'string' && definition[required].length > 0) continue;
      gaps.push(`${field}: missing ${required}`);
    }
  }
  return gaps.sort(compareText);
}

export function findForbiddenThemeProductPaths(tokens, forbiddenPaths) {
  return forbiddenPaths.filter((tokenPath) => hasPath(tokens, tokenPath)).sort(compareText);
}

export function findProductSemanticUtilityConsumers(sources, forbiddenUtilityPattern) {
  const pattern = new RegExp(forbiddenUtilityPattern, 'g');
  return Object.entries(sources)
    .flatMap(([filePath, source]) =>
      [...source.matchAll(pattern)].map((match) => `${filePath}: ${match[0]}`)
    )
    .sort(compareText);
}

export function findTailwindAliasProblems(source) {
  const declarations = [...source.matchAll(/(--color-[A-Za-z0-9_-]+)\s*:\s*([^;]+)\s*;/g)];
  const counts = new Map();
  const problems = [];

  for (const [, target, value] of declarations) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
    const normalizedValue = value.trim();
    if (!/^var\(--em-[A-Za-z0-9_-]+\)$/.test(normalizedValue)) {
      problems.push(`${target}: noncanonical value ${normalizedValue}`);
    }
  }
  for (const [target, count] of counts) {
    if (count > 1) problems.push(`${target}: duplicate target`);
  }

  return problems.sort(compareText);
}

function hasPath(value, tokenPath) {
  let current = value;
  for (const segment of tokenPath.split('.')) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
