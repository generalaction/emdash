const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'src', 'main', 'appConfig.json');
const destDir = path.join(repoRoot, 'dist', 'main');
const dest = path.join(destDir, 'appConfig.json');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
