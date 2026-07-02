import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Restore node-pty's bundled ConPTY next to the rebuilt native module.
 *
 * node-pty's own postinstall copies `third_party/conpty/<ver>/win10-<arch>/`
 * into `build/Release/conpty/`, but every electron-rebuild (dev postinstall,
 * `pnpm run rebuild`, release rebuild-native.ts, CI) runs `node-gyp rebuild`,
 * which wipes build/Release — and with it the dll that `useConptyDll: true`
 * (see src/main/core/pty/conpty-dll.ts) resolves relative to conpty.node.
 * This must therefore run after every electron-rebuild of node-pty.
 *
 * Returns true when the dll files were copied, false when skipped (non-win32,
 * no rebuilt output, or a node-pty version without the bundled dll).
 */
export function copyConptyDll(options: { nodePtyRoot: string; arch?: string }): boolean {
  if (process.platform !== 'win32') return false;

  const { nodePtyRoot } = options;
  const arch = options.arch ?? process.arch;
  if (!['x64', 'arm64'].includes(arch)) {
    console.warn(`copy-conpty-dll: unsupported arch ${arch}, skipping`);
    return false;
  }

  const releaseDir = path.join(nodePtyRoot, 'build', 'Release');
  if (!existsSync(path.join(releaseDir, 'conpty.node'))) {
    // No rebuilt output — node-pty's prebuilds ship their own conpty/ folder.
    return false;
  }

  const requiredFiles = ['conpty.dll', 'OpenConsole.exe'];
  const conptyBase = path.join(nodePtyRoot, 'third_party', 'conpty');
  // Pick the version folder deterministically and only if it holds the full
  // payload for this arch — readdir order is not guaranteed and stray entries
  // (dotfiles, incomplete folders) must not win or crash the copy below.
  const versionFolder = (existsSync(conptyBase) ? readdirSync(conptyBase).sort() : []).find(
    (folder) =>
      requiredFiles.every((file) =>
        existsSync(path.join(conptyBase, folder, `win10-${arch}`, file))
      )
  );
  if (!versionFolder) {
    console.warn(
      `copy-conpty-dll: no bundled ConPTY for arch ${arch} under ${conptyBase}, skipping`
    );
    return false;
  }

  const sourceDir = path.join(conptyBase, versionFolder, `win10-${arch}`);
  const destDir = path.join(releaseDir, 'conpty');
  mkdirSync(destDir, { recursive: true });
  for (const file of requiredFiles) {
    copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
  }
  console.log(`copy-conpty-dll: copied ConPTY ${versionFolder} (win10-${arch}) to ${destDir}`);
  return true;
}

export function resolveNodePtyRoot(): string {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve('node-pty/package.json'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archFlagIndex = process.argv.indexOf('--arch');
  const arch = archFlagIndex === -1 ? undefined : process.argv[archFlagIndex + 1];
  copyConptyDll({ nodePtyRoot: resolveNodePtyRoot(), arch });
}
