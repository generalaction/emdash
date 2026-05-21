/* eslint-disable */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dmgPath = path.resolve(process.argv[2] || 'release/emdash-arm64.dmg');
if (!fs.existsSync(dmgPath)) throw new Error(`DMG not found: ${dmgPath}`);

const cacheRoot = path.join(os.homedir(), 'Library/Caches/electron-builder/dmg-builder@1.2.0');
const bundle = fs
  .readdirSync(cacheRoot)
  .map((name) => path.join(cacheRoot, name))
  .find((entry) => fs.existsSync(path.join(entry, 'python/bin/python3.14')));
if (!bundle) throw new Error(`Could not find electron-builder dmgbuild bundle in ${cacheRoot}`);

const python = path.join(bundle, 'python/bin/python3.14');
const sitePackages = path.join(bundle, 'python/lib/python3.14/site-packages');
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
const mountPoint = attachOutput.match(/\/Volumes\/Install Emdash[^\n]*/)?.[0];
if (!device || !mountPoint) throw new Error(`Could not parse hdiutil attach output:\n${attachOutput}`);

try {
  console.log(`replacing Applications symlink with custom-icon Finder alias at ${mountPoint}...`);
  const applicationsPath = path.join(mountPoint, 'Applications');
  try {
    fs.unlinkSync(applicationsPath);
  } catch {
    fs.rmSync(applicationsPath, { force: true, recursive: true });
  }
  execFileSync(
    'osascript',
    [
      '-e',
      `tell application "Finder" to make new alias file to POSIX file "/Applications" at POSIX file "${mountPoint}" with properties {name:"Applications"}`,
    ],
    { stdio: 'inherit' },
  );

  const customIcon = path.resolve('build/applications-alias.icns');
  if (!fs.existsSync(customIcon)) {
    execFileSync(process.execPath, ['build/create-applications-alias-icon.cjs', customIcon], { stdio: 'inherit' });
  }
  const rezFile = path.join(tmpDir, 'applications-icon.r');
  const iconHex = fs
    .readFileSync(customIcon)
    .toString('hex')
    .match(/.{1,64}/g)
    .map((line) => `    $\"${line}\"`)
    .join('\n');
  fs.writeFileSync(rezFile, `data 'icns' (-16455) {\n${iconHex}\n};\n`);
  execFileSync('Rez', ['-append', rezFile, '-o', applicationsPath], { stdio: 'inherit' });
  execFileSync('SetFile', ['-a', 'C', applicationsPath], { stdio: 'inherit' });

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
