// Derives surface hover/selected state-layer tokens from surface base tokens
// using OKLab perceptual lightness shifts for constant perceived contrast.
//
// Reads primitives.tokens.json, writes primitives.generated.json with hover/selected added.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Color from 'colorjs.io';

const __dirname = dirname(fileURLToPath(import.meta.url));

// OKLab L delta for each interaction state (0–1 scale).
// Applied mode-aware: light surfaces darken, dark surfaces lighten.
const STATE_DELTAS = {
  hover: 0.04,
  selected: 0.08,
};

const MODES = ['light', 'dark'];

/**
 * Shift the OKLab L component of a display-p3 color by `delta`,
 * in the direction appropriate for the given mode.
 */
function deriveStateLayer(p3channels, mode, delta) {
  // colorjs.io uses 'p3' as the space id for display-p3
  const c = new Color('p3', p3channels).to('oklab');
  // Light surfaces darken on hover/selected; dark surfaces lighten.
  const direction = mode === 'dark' ? 1 : -1;
  c.coords[0] = Math.max(0, Math.min(1, c.coords[0] + direction * delta));
  const result = c.to('p3');
  // Terrazzo 0.6.x DTCG format: 'channels' (not 'components')
  return {
    colorSpace: 'display-p3',
    channels: result.coords.map((n) => +n.toFixed(4)),
  };
}

const tokensPath = join(__dirname, 'primitives.tokens.json');
const outputPath = join(__dirname, 'primitives.generated.json');

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

// Deep-clone to avoid mutating the source
const generated = JSON.parse(JSON.stringify(tokens));

// Derive hover/selected for each surface family
for (const [familyName, familyToken] of Object.entries(generated.surface)) {
  if (familyName === '$type') continue;
  if (!familyToken.$extensions?.mode) continue;

  for (const [stateName, delta] of Object.entries(STATE_DELTAS)) {
    const stateKey = `${familyName}-${stateName}`;
    const modeValues = {};

    for (const mode of MODES) {
      // Mode values are direct color objects (no $value wrapper) per Terrazzo 0.6 format
      const baseValue = familyToken.$extensions.mode[mode];
      if (!baseValue || typeof baseValue !== 'object') continue;

      modeValues[mode] = deriveStateLayer(baseValue.channels, mode, delta);
    }

    generated.surface[stateKey] = {
      // Use light value as the default $value for the token (required by Terrazzo)
      $value: modeValues.light,
      $extensions: { mode: modeValues },
    };
  }
}

writeFileSync(outputPath, JSON.stringify(generated, null, 2));
console.log('✓ Derived surface state layers → primitives.generated.json');
