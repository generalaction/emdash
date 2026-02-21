const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

for (const dir of ['node_modules', 'dist']) {
  fs.rmSync(path.join(repoRoot, dir), { recursive: true, force: true });
}
