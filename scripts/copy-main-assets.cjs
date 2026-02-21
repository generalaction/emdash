const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const assets = [
  {
    src: path.join(repoRoot, 'src', 'main', 'appConfig.json'),
    dest: path.join(repoRoot, 'dist', 'main', 'appConfig.json'),
  },
  {
    src: path.join(repoRoot, 'src', 'main', 'services', 'skills', 'bundled-catalog.json'),
    dest: path.join(repoRoot, 'dist', 'main', 'main', 'services', 'skills', 'bundled-catalog.json'),
  },
];

for (const asset of assets) {
  if (!fs.existsSync(asset.src)) {
    // eslint-disable-next-line no-console
    console.error(`copy-main-assets: missing source file: ${asset.src}`);
    process.exit(1);
  }
  copyFile(asset.src, asset.dest);
}
