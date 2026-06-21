import { execSync } from 'node:child_process';
/**
 * Watches tokens.json and re-runs theme:build whenever it changes.
 * Run via: pnpm run theme:watch
 * Storybook HMR then picks up the updated theme.css automatically.
 */
import { watch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname, 'tokens.json');

console.log('Watching tokens.json for changes…');

// Run once on start so the generated files are always fresh.
runBuild();

let debounce = null;
watch(tokensPath, () => {
  clearTimeout(debounce);
  debounce = setTimeout(runBuild, 100);
});

function runBuild() {
  console.log('\ntoken change detected — rebuilding theme…');
  try {
    execSync('pnpm run theme:build', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'inherit',
    });
  } catch {
    console.error('theme:build failed — check the output above');
  }
}
