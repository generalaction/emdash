#!/usr/bin/env tsx
/**
 * codegen/run.ts — Theme code generation orchestrator.
 *
 * Imports all theme definitions, resolves them into CSS + TS artifacts,
 * and writes the output files.
 *
 * Emits:
 *   theme/__generated__/styles.css          — canonical Color/Density/Typography Token Values
 *   theme/__generated__/shiki-themes.gen.ts — single var-based Shiki theme (emSyntaxTheme)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DENSITIES } from '../../densities/registry';
import { darkTheme } from '../../themes/dark.theme';
import { lightTheme } from '../../themes/light.theme';
import { solarizedDarkTheme } from '../../themes/solarized-dark.theme';
import { solarizedLightTheme } from '../../themes/solarized-light.theme';
import { ALL_TYPOGRAPHIES } from '../../typographies/registry';
import { defineColorScheme, defineDensityProfile, profileValuesFromCssVars } from '../compiler';
import type { ColorSchemeDefinition, DensityProfileDefinition } from '../compiler';
import type { ResolvedDensity } from '../define-density';
import type { ResolvedTheme } from '../define-theme';
import { emitShikiThemesTs } from './emit-shiki';
import { emitStylesCss } from './emit-styles-css';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Output directories — generated CSS lands in theme/__generated__/
const GENERATED_DIR = join(__dirname, '..', '..', '__generated__');

const ALL_THEMES: ResolvedTheme[] = [
  lightTheme,
  darkTheme,
  solarizedLightTheme,
  solarizedDarkTheme,
];

const DENSITIES: ResolvedDensity[] = [...ALL_DENSITIES];

function run(): void {
  const themes = ALL_THEMES;
  const densities = DENSITIES;
  const colorSchemeDefinitions: ColorSchemeDefinition[] = themes.map((theme) =>
    defineColorScheme({
      id: theme.id,
      label: theme.label,
      polarity: theme.polarity,
      selector: theme.selector as `.${string}`,
      values: profileValuesFromCssVars('color-scheme', theme.cssVars),
    })
  );
  const densityDefinitions: DensityProfileDefinition[] = densities.map((density) =>
    defineDensityProfile({
      id: density.id,
      label: density.label,
      selector: density.selector as `.${string}`,
      values: profileValuesFromCssVars('density', density.cssVars),
    })
  );

  console.log(
    `Building ${themes.length} Color scheme(s): ${themes.map((t) => t.id).join(', ')}; ${densities.length} Density profile(s): ${densities.map((d) => d.id).join(', ')}; ${ALL_TYPOGRAPHIES.length} Typography profile(s): ${ALL_TYPOGRAPHIES.map((t) => t.id).join(', ')}`
  );

  // Ensure output directory exists
  mkdirSync(GENERATED_DIR, { recursive: true });

  // theme/__generated__/styles.css — public canonical artifact
  writeFileSync(
    join(GENERATED_DIR, 'styles.css'),
    emitStylesCss({
      colorSchemes: colorSchemeDefinitions,
      densities: densityDefinitions,
      typographies: ALL_TYPOGRAPHIES,
    }),
    'utf8'
  );
  console.log('✓ theme/__generated__/styles.css');

  // theme/__generated__/shiki-themes.gen.ts
  writeFileSync(join(GENERATED_DIR, 'shiki-themes.gen.ts'), emitShikiThemesTs(), 'utf8');
  console.log('✓ theme/__generated__/shiki-themes.gen.ts');

  console.log('\nTheme build complete.');
}

run();
