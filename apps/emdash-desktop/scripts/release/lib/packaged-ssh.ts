import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

/** Import the finished main bundle's ssh2 specifiers using the Electron runtime that ships. */
export async function verifyPackagedSsh(app: {
  executable: string;
  resourcesDirectory: string;
}): Promise<void> {
  const resources = await realpath(app.resourcesDirectory);
  const probe = String.raw`
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync, readdirSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';

    const resources = process.argv[1];
    const main = join(resources, 'app.asar/out/main');
    let imports = 0;
    for (const entry of readdirSync(main, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const file = join(entry.parentPath, entry.name);
      const source = readFileSync(file, 'utf8');
      // electron-vite emits static external imports on separate lines, without minification.
      const external = /^import\s+(?:.*?\s+from\s+)?["'](ssh2(?:\/[^"']*)?)["']/gm;
      for (const match of source.matchAll(external)) {
        ++imports;
        const url = import.meta.resolve(match[1], pathToFileURL(file).href);
        assert(url.startsWith(pathToFileURL(join(resources, 'app.asar/node_modules/ssh2/')).href),
          'ssh2 resolved outside the packaged app: ' + url);
        const { default: ssh2, BaseAgent } = await import(url);
        assert.equal(typeof ssh2.Client, 'function');
        assert.equal(typeof BaseAgent, 'function');
        assert.equal(typeof ssh2.CygwinAgent, 'function');
        assert.equal(typeof ssh2.PageantAgent, 'function');
        if (process.platform === 'win32') {
          const helper = join(dirname(fileURLToPath(url)), '../util/pagent.exe');
          assert(existsSync(helper), 'Missing Pageant helper relative to ssh2: ' + helper);
          assert(existsSync(helper.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')),
            'Pageant helper must be unpacked');
        }
      }
    }
    assert(imports > 0, 'No external ssh2 imports found in the packaged main bundle');
    console.log('Packaged ssh2 verified');
  `;
  const { stdout } = await promisify(execFile)(
    app.executable,
    ['--experimental-import-meta-resolve', '--input-type=module', '-e', probe, resources],
    {
      cwd: resources,
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        PATH: '',
        ELECTRON_RUN_AS_NODE: '1',
      },
      windowsHide: true,
      timeout: 30_000,
    }
  );
  assert.equal(stdout.trim(), 'Packaged ssh2 verified');
}
