/* eslint-disable */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dmgConfig = require('./dmg-config.cjs');

const dmgPath = path.resolve(process.argv[2] || 'release/emdash-arm64.dmg');
if (!fs.existsSync(dmgPath)) throw new Error(`DMG not found: ${dmgPath}`);

const cacheParent = path.join(os.homedir(), 'Library/Caches/electron-builder');
const bundle = fs
  .readdirSync(cacheParent)
  .filter((name) => name.startsWith('dmg-builder@'))
  .flatMap((name) => fs.readdirSync(path.join(cacheParent, name)).map((entry) => path.join(cacheParent, name, entry)))
  .find((entry) => fs.existsSync(path.join(entry, 'python/bin')));
if (!bundle) throw new Error(`Could not find electron-builder dmgbuild bundle in ${cacheParent}`);

const pythonBin = path.join(bundle, 'python/bin');
const python = fs
  .readdirSync(pythonBin)
  .map((name) => path.join(pythonBin, name))
  .find((entry) => path.basename(entry).startsWith('python3'));
if (!python) throw new Error(`Could not find Python in ${pythonBin}`);

const pythonLib = path.join(bundle, 'python/lib');
const sitePackages = fs
  .readdirSync(pythonLib)
  .map((name) => path.join(pythonLib, name, 'site-packages'))
  .find((entry) => fs.existsSync(entry));
if (!sitePackages) throw new Error(`Could not find Python site-packages in ${pythonLib}`);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-dmg-patch-'));
const rwDmg = path.join(tmpDir, 'rw.dmg');
const outDmg = path.join(tmpDir, 'out.dmg');

function hdiutil(args) {
  return execFileSync('hdiutil', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function detach(device) {
  try {
    hdiutil(['detach', device]);
  } catch {
    hdiutil(['detach', '-force', device]);
  }
}

console.log('converting DMG to read/write...');
hdiutil(['convert', dmgPath, '-format', 'UDRW', '-o', rwDmg]);

console.log('attaching read/write DMG...');
const attachOutput = hdiutil(['attach', '-readwrite', '-noverify', '-noautoopen', rwDmg]);
const device = attachOutput.match(/^(\/dev\/\S+)/m)?.[1];
const volumeName = dmgConfig.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mountPoint = attachOutput.match(new RegExp(`/Volumes/${volumeName}[^\\n]*`))?.[0].trim();
if (!device || !mountPoint) throw new Error(`Could not parse hdiutil attach output:\n${attachOutput}`);

try {
  const appPath = path.join(mountPoint, `${dmgConfig.appName}.app`);
  if (fs.existsSync(appPath)) {
    execFileSync('SetFile', ['-a', 'E', appPath], { stdio: 'inherit' });
  }

  console.log(`patching Finder view at ${mountPoint}...`);
  execFileSync(
    python,
    [
      '-c',
      `from ds_store import DSStore\n` +
        `p = r'''${path.join(mountPoint, '.DS_Store')}'''\n` +
        `with DSStore.open(p, 'r+') as d:\n` +
        `    icvp = d['.']['icvp']\n` +
        `    icvp['iconSize'] = 100.0\n` +
        `    icvp['showIconPreview'] = True\n` +
        `    d['.']['icvp'] = icvp\n` +
        `    d.flush()\n`,
    ],
    { env: { ...process.env, PYTHONPATH: sitePackages }, stdio: 'inherit' },
  );
} finally {
  console.log('detaching...');
  detach(device);
}

console.log('converting patched DMG back to compressed UDZO...');
hdiutil(['convert', rwDmg, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', outDmg]);
fs.copyFileSync(outDmg, dmgPath);
console.log(`patched ${dmgPath}`);
