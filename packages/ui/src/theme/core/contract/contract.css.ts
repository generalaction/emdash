/**
 * VE theme contract: maps camelCase TypeScript keys to the stable CSS custom
 * property names emitted by theme/__generated__/theme.css and theme/__generated__/semantic.css.
 *
 * This is a REFERENCE-ONLY contract (createGlobalThemeContract only, no
 * createGlobalTheme). Values come from the generated CSS files and .em<id>
 * class selectors. The contract is derived programmatically from the single
 * source of truth: SEMANTIC_TEMPLATE (semantic slots) + allSurfaceVarNames()
 * (surface cascade and elevation vars from roles.ts).
 *
 * The file path is kept stable so all downstream .css.ts consumers are
 * unaffected by internal refactors.
 */

import { createGlobalThemeContract } from '@vanilla-extract/css';
import { nsName } from './namespace';
import { allSurfaceVarNames } from './roles';
import { SEMANTIC_TEMPLATE } from './semantic-template';

const toCamel = (s: string) => s.replace(/-([a-z0-9])/g, (_: string, c: string) => c.toUpperCase());

const semanticKeys = Object.fromEntries(
  Object.keys(SEMANTIC_TEMPLATE).map((slot) => [toCamel(slot), slot])
);

const surfaceKeys = Object.fromEntries(allSurfaceVarNames().map((v) => [toCamel(v), v]));

export const vars = createGlobalThemeContract({ ...semanticKeys, ...surfaceKeys }, (name) =>
  nsName(name ?? '')
);

export type Vars = typeof vars;
