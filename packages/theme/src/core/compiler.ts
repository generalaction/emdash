import { tokens, type TokenReference, type Tokens } from './tokens';

type StringKey<T> = Extract<keyof T, string>;
type LeafPaths<T> = {
  [Key in StringKey<T>]: T[Key] extends TokenReference
    ? Key
    : T[Key] extends object
      ? `${Key}.${LeafPaths<T[Key]>}`
      : never;
}[StringKey<T>];

export type TokenPath = LeafPaths<Tokens>;
export type ColorTokenPath = Exclude<
  Extract<
    TokenPath,
    | `palette.${string}`
    | `shadow.${string}`
    | `foreground.${string}`
    | `border.${string}`
    | `surface.${string}`
    | `feedback.${string}`
    | `selection.${string}`
  >,
  `surface.current.${string}`
>;
export type DensityTokenPath = Extract<TokenPath, `space.${string}` | `radius.${string}`>;
export type TypographyTokenPath = Extract<TokenPath, `typography.${string}`>;

export type ColorSchemeDefinition = Readonly<{
  kind: 'color-scheme';
  id: string;
  label: string;
  polarity: 'light' | 'dark';
  selector: `.${string}`;
  values: Readonly<Record<ColorTokenPath, string>>;
}>;

export type DensityProfileDefinition = Readonly<{
  kind: 'density';
  id: string;
  label: string;
  selector: `.${string}`;
  values: Readonly<Record<DensityTokenPath, string>>;
}>;

export type TypographyProfileDefinition = Readonly<{
  kind: 'typography';
  id: string;
  label: string;
  selector: `.${string}`;
  values: Readonly<Record<TypographyTokenPath, string>>;
}>;

export type ProfileDefinition =
  | ColorSchemeDefinition
  | DensityProfileDefinition
  | TypographyProfileDefinition;

export type CompiledProfile = Readonly<{
  kind: ProfileDefinition['kind'];
  id: string;
  label: string;
  selector: `.${string}`;
  cssVars: Readonly<Record<`--em-${string}`, string>>;
}>;

type CatalogEntry = Readonly<{
  path: TokenPath;
  reference: TokenReference;
  cssName: `--em-${string}`;
}>;

function cssNameFromReference(reference: TokenReference): `--em-${string}` {
  const match = /^var\((--em-[^)]+)\)$/.exec(reference);
  if (!match) {
    throw new Error(`invalid Token Reference "${reference}"`);
  }
  return match[1] as `--em-${string}`;
}

function buildCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  function visit(value: object, parent = ''): void {
    for (const [key, child] of Object.entries(value)) {
      const path = parent ? `${parent}.${key}` : key;
      if (typeof child === 'string') {
        const reference = child as TokenReference;
        entries.push({
          path: path as TokenPath,
          reference,
          cssName: cssNameFromReference(reference),
        });
      } else {
        visit(child as object, path);
      }
    }
  }

  visit(tokens);
  return entries;
}

const TOKEN_CATALOG = buildCatalog();

function isOwnedBy(kind: ProfileDefinition['kind'], path: TokenPath): boolean {
  if (kind === 'color-scheme') {
    return (
      !path.startsWith('surface.current.') &&
      ['palette.', 'shadow.', 'foreground.', 'border.', 'surface.', 'feedback.', 'selection.'].some(
        (prefix) => path.startsWith(prefix)
      )
    );
  }
  if (kind === 'density') {
    return path.startsWith('space.') || path.startsWith('radius.');
  }
  return path.startsWith('typography.');
}

function entriesFor(kind: ProfileDefinition['kind']): CatalogEntry[] {
  return TOKEN_CATALOG.filter(({ path }) => isOwnedBy(kind, path));
}

function validateMetadata(definition: ProfileDefinition): void {
  if (definition.id.trim().length === 0) {
    throw new Error(`${definition.kind} Profile Definition has an empty id`);
  }
  if (definition.label.trim().length === 0) {
    throw new Error(`${definition.kind} Profile Definition has an empty label`);
  }
  if (!definition.selector.startsWith('.') || definition.selector.length === 1) {
    throw new Error(
      `${definition.kind} Profile Definition has invalid selector "${definition.selector}"`
    );
  }
}

export function defineColorScheme<const Definition extends Omit<ColorSchemeDefinition, 'kind'>>(
  definition: Definition
): ColorSchemeDefinition & Definition {
  return { kind: 'color-scheme', ...definition };
}

export function defineDensityProfile<
  const Definition extends Omit<DensityProfileDefinition, 'kind'>,
>(definition: Definition): DensityProfileDefinition & Definition {
  return { kind: 'density', ...definition };
}

export function defineTypographyProfile<
  const Definition extends Omit<TypographyProfileDefinition, 'kind'>,
>(definition: Definition): TypographyProfileDefinition & Definition {
  return { kind: 'typography', ...definition };
}

/**
 * Validate one Profile Definition against the canonical Token catalog and
 * compile its path-keyed Token Values to CSS custom-property assignments.
 */
export function compileProfile(definition: ProfileDefinition): CompiledProfile {
  validateMetadata(definition);
  const expected = entriesFor(definition.kind);
  const values = definition.values as Readonly<Record<string, string>>;
  const expectedPaths = new Set(expected.map(({ path }) => path));

  for (const { path } of expected) {
    if (!Object.hasOwn(values, path)) {
      throw new Error(
        `${definition.kind} profile "${definition.id}" is missing Token Value "${path}"`
      );
    }
    if (values[path]!.length === 0) {
      throw new Error(
        `${definition.kind} profile "${definition.id}" has empty Token Value "${path}"`
      );
    }
  }

  for (const path of Object.keys(values)) {
    if (!expectedPaths.has(path as TokenPath)) {
      throw new Error(
        `${definition.kind} profile "${definition.id}" has extra Token Value "${path}"`
      );
    }
  }

  const cssVars: Record<`--em-${string}`, string> = {};
  for (const { path, cssName } of expected) {
    cssVars[cssName] = values[path]!;
  }

  return {
    kind: definition.kind,
    id: definition.id,
    label: definition.label,
    selector: definition.selector,
    cssVars,
  };
}

/**
 * Adapt an existing CSS custom-property map into a path-keyed Profile
 * Definition input. This keeps legacy values while the public catalog changes
 * to domain-first Token paths.
 */
export function profileValuesFromCssVars(
  kind: 'color-scheme',
  cssVars: Readonly<Record<string, string>>
): Record<ColorTokenPath, string>;
export function profileValuesFromCssVars(
  kind: 'density',
  cssVars: Readonly<Record<string, string>>
): Record<DensityTokenPath, string>;
export function profileValuesFromCssVars(
  kind: 'typography',
  cssVars: Readonly<Record<string, string>>
): Record<TypographyTokenPath, string>;
export function profileValuesFromCssVars(
  kind: ProfileDefinition['kind'],
  cssVars: Readonly<Record<string, string>>
): Record<string, string> {
  return Object.fromEntries(
    entriesFor(kind).map(({ path, cssName }) => {
      const value = cssVars[cssName];
      if (value == null) {
        throw new Error(`${kind} source is missing canonical value "${cssName}" for "${path}"`);
      }
      return [path, value];
    })
  );
}

export const BASE_TOKEN_VALUES = {
  'surface.current.background': tokens.surface.level.base.background,
  'surface.current.hover': tokens.surface.level.base.hover,
  'surface.current.selected': tokens.surface.level.base.selected,
  'surface.current.emphasis': tokens.surface.level.raised.background,
  'surface.current.emphasisHover': tokens.surface.level.raised.hover,
  'surface.current.emphasisSelected': tokens.surface.level.raised.selected,
  'surface.current.input': `color-mix(in srgb, ${tokens.surface.current.background} 94%, ${tokens.foreground.default})`,
  'surface.current.border': tokens.border.default,
  'surface.current.foreground': tokens.foreground.default,
  'motion.duration.fast': '140ms',
  'motion.duration.normal': '200ms',
  'motion.duration.slow': '220ms',
  'motion.easing.standard': 'ease-out',
  'motion.easing.emphasized': 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const satisfies Readonly<
  Record<Extract<TokenPath, `surface.current.${string}` | `motion.${string}`>, string>
>;

export function compileBaseTokenValues(): Readonly<Record<`--em-${string}`, string>> {
  const values = BASE_TOKEN_VALUES as Readonly<Record<string, string>>;
  const expected = TOKEN_CATALOG.filter(
    ({ path }) => path.startsWith('surface.current.') || path.startsWith('motion.')
  );
  const cssVars: Record<`--em-${string}`, string> = {};

  for (const { path, cssName } of expected) {
    const value = values[path];
    if (value == null) {
      throw new Error(`base Theme values are missing Token Value "${path}"`);
    }
    cssVars[cssName] = value;
  }

  return cssVars;
}
