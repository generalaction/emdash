import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createChildProcessTreeTerminator } from '@emdash/core/primitives/exec/node';
import { waitWithSignal } from '@emdash/shared/scheduling';
import type { AfterPackContext, LinuxPackager } from 'electron-builder';
import {
  ConfigurationRequest,
  DefinitionRequest,
  DidOpenTextDocumentNotification,
  ExitNotification,
  HoverRequest,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  createProtocolConnection,
  type Diagnostic,
} from 'vscode-languageserver-protocol/node.js';
import { z } from 'zod';

export interface PackagedLanguageServerApp {
  executable: string;
  resourcesDirectory: string;
}

export function packagedLanguageServerApp(context: AfterPackContext): PackagedLanguageServerApp {
  const resourcesDirectory = context.packager.getResourcesDir(context.appOutDir);
  const product = context.packager.appInfo.productFilename;
  const executable =
    context.electronPlatformName === 'darwin'
      ? join(dirname(resourcesDirectory), 'MacOS', product)
      : join(
          context.appOutDir,
          context.electronPlatformName === 'win32'
            ? `${product}.exe`
            : (context.packager as LinuxPackager).executableName
        );
  return { executable, resourcesDirectory };
}

/** Exercise the finished app's Electron executable, module resolution and unpacked assets. */
export async function verifyPackagedLanguageServers(app: PackagedLanguageServerApp): Promise<void> {
  const resources = await realpath(app.resourcesDirectory);
  const root = await mkdtemp(join(tmpdir(), 'emdash-packaged-lsp-'));
  const env: NodeJS.ProcessEnv = {
    // Keep only the Windows loader's required environment; no global tools or Node injection.
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    PATH: '',
    HOME: root,
    USERPROFILE: root,
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    ELECTRON_RUN_AS_NODE: '1',
  };
  try {
    const { stdout } = await promisify(execFile)(
      app.executable,
      [
        '--input-type=module',
        '-e',
        `import { createRequire } from 'node:module';
         const app = createRequire(${JSON.stringify(join(resources, 'app.asar/package.json'))});
         console.log(JSON.stringify({
           electron: process.versions.electron,
           typescript: app.resolve('typescript-language-server/lib/cli.mjs'),
           compiler: app.resolve('typescript/lib/tsserver.js'),
           python: app.resolve('pyright/langserver.index.js')
         }));`,
      ],
      { cwd: root, env, timeout: 30_000 }
    );
    const assets = z
      .object({
        electron: z.string(),
        typescript: z.string(),
        compiler: z.string(),
        python: z.string(),
      })
      .parse(JSON.parse(stdout));
    const physical = async (filename: string) => {
      const resolved = await realpath(
        filename.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
      );
      const inside = relative(resources, resolved);
      assert(
        !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`),
        `Language-server asset escaped the packaged app: ${resolved}`
      );
      return resolved;
    };
    const compiler = await physical(assets.compiler);
    const typescript = await physical(assets.typescript);
    const python = await physical(assets.python);
    const standardLibrary = join(dirname(compiler), 'lib.es5.d.ts');
    const pythonStubs = join(dirname(python), 'dist/typeshed-fallback/stdlib');
    await access(standardLibrary);
    await access(join(pythonStubs, 'builtins.pyi'));
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, types: [], lib: ['es5'] } })
    );
    await checkServer('typescript', typescript, standardLibrary);
    await checkServer('python', python, pythonStubs);

    async function checkServer(language: 'typescript' | 'python', entry: string, library: string) {
      const child = spawn(app.executable, [entry, '--stdio'], {
        cwd: root,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      const terminator = createChildProcessTreeTerminator(child, {
        processGroup: process.platform !== 'win32',
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-8_000);
      });
      const connection = createProtocolConnection(child.stdout, child.stdin);
      const lifetime = new AbortController();
      child.on('error', (error) => lifetime.abort(error));
      child.on('exit', (code) => lifetime.abort(new Error(`${language} exited with code ${code}`)));
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000)]);
      const analysis = { typeCheckingMode: 'basic', useLibraryCodeForTypes: false };
      connection.onRequest(ConfigurationRequest.type, ({ items }) =>
        items.map(({ section }) =>
          section === 'python' ? { analysis } : section === 'python.analysis' ? analysis : {}
        )
      );
      connection.listen();
      try {
        await waitWithSignal(exercise(), signal);
      } catch (error) {
        throw new Error(`Packaged ${language} smoke check failed.\n${stderr}`, { cause: error });
      } finally {
        connection.dispose();
        await terminator.terminate();
      }

      async function exercise() {
        await connection.sendRequest(InitializeRequest.type, {
          processId: process.pid,
          rootUri: pathToFileURL(root).href,
          workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'smoke' }],
          capabilities: {
            workspace: { configuration: true, workspaceFolders: true },
            textDocument: { publishDiagnostics: { versionSupport: true } },
          },
          ...(language === 'typescript'
            ? {
                initializationOptions: {
                  disableAutomaticTypingAcquisition: true,
                  tsserver: { path: compiler },
                },
              }
            : {}),
        });
        await connection.sendNotification(InitializedNotification.type, {});
        const uri = pathToFileURL(
          join(root, language === 'typescript' ? 'smoke.ts' : 'smoke.py')
        ).href;
        const diagnostics = new Promise<Diagnostic[]>((resolve) => {
          connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
            if (params.uri === uri && params.diagnostics.length) resolve(params.diagnostics);
          });
        });
        const text =
          language === 'typescript'
            ? 'const value: string = [1, 2].map(item => item + 1);\n'
            : 'from pathlib import Path\nvalue: str = Path(".").resolve()\n';
        await connection.sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: { uri, languageId: language, version: 1, text },
        });
        const query = {
          textDocument: { uri },
          position:
            language === 'typescript'
              ? { line: 0, character: text.indexOf('.map') + 2 }
              : { line: 1, character: 25 },
        };
        const hover = await connection.sendRequest(HoverRequest.type, query);
        assert(hover, `${language} standard-library hover was empty`);
        const definition = await connection.sendRequest(DefinitionRequest.type, query);
        const locations = Array.isArray(definition) ? definition : definition ? [definition] : [];
        assert(
          locations.some((location) => {
            const target = fileURLToPath(
              'targetUri' in location ? location.targetUri : location.uri
            );
            return language === 'typescript'
              ? relative(library, target) === ''
              : target.startsWith(`${library}${sep}`) && target.endsWith('.pyi');
          }),
          `${language} definition did not resolve into the packaged standard library: ${JSON.stringify(definition)}`
        );
        const reported = await diagnostics;
        assert.equal(reported.length, 1, JSON.stringify(reported));
        assert.equal(
          reported[0].code,
          language === 'typescript' ? 2322 : 'reportAssignmentType',
          JSON.stringify(reported)
        );
        await connection.sendRequest(ShutdownRequest.type);
        await connection.sendNotification(ExitNotification.type);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
