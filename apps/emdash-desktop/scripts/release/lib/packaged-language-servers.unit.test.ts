import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type * as NodePath from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type * as NodeUrl from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DefinitionRequest,
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  createProtocolConnection,
  type ProtocolConnection,
} from 'vscode-languageserver-protocol/node.js';
import { verifyPackagedLanguageServers } from './packaged-language-servers.ts';

const fixture = vi.hoisted(() => ({
  windows: false,
  diagnostics: 'matching' as 'matching' | 'other' | 'wrong-case',
  definition: 'matching' as 'matching' | 'sibling' | 'parent' | 'other-drive',
  hangAtHover: false,
}));
const servers: ProtocolConnection[] = [];

// Exercise the real verifier and JSON-RPC exchange with both host path dialects.
// Only the packaged executable and its filesystem are substituted.
vi.mock('node:path', async (importOriginal) => {
  const path = await importOriginal<typeof NodePath>();
  const native = () => (fixture.windows ? path.win32 : path.posix);
  return {
    ...path,
    join: (...parts: string[]) => native().join(...parts),
    dirname: (value: string) => native().dirname(value),
    relative: (from: string, to: string) => native().relative(from, to),
    isAbsolute: (value: string) => native().isAbsolute(value),
    get sep() {
      return native().sep;
    },
  };
});
vi.mock('node:url', async (importOriginal) => {
  const url = await importOriginal<typeof NodeUrl>();
  return {
    ...url,
    fileURLToPath: (value: string | URL) => url.fileURLToPath(value, { windows: fixture.windows }),
    pathToFileURL: (value: string) => url.pathToFileURL(value, { windows: fixture.windows }),
  };
});
vi.mock('node:os', () => ({ tmpdir: () => (fixture.windows ? 'C:\\Temp' : '/tmp') }));
vi.mock('node:fs/promises', () => ({
  realpath: async (value: string) => value,
  mkdtemp: async (prefix: string) => `${prefix}probe #1`,
  access: async () => {},
  writeFile: async () => {},
  rm: async () => {},
}));
vi.mock('@emdash/core/primitives/exec/node', () => ({
  createChildProcessTreeTerminator: () => ({ terminate: async () => {} }),
}));
vi.mock('node:child_process', () => ({
  execFile: (
    _executable: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, result: { stdout: string }) => void
  ) => callback(null, { stdout: JSON.stringify({ electron: '40.10.2', ...assets() }) }),
  spawn: (_executable: string, [entry]: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const server = createProtocolConnection(child.stdin, child.stdout);
    servers.push(server);
    const typescript = entry === assets().typescript;
    server.onRequest(InitializeRequest.type, () => ({ capabilities: {} }));
    server.onNotification(DidOpenTextDocumentNotification.type, async ({ textDocument }) => {
      const uri = textDocument.uri;
      // An unrelated publication must never satisfy the probe's diagnostic assertion.
      await server.sendNotification(PublishDiagnosticsNotification.type, {
        uri: responseUri(uri.replace(/smoke\.(ts|py)$/, 'other.$1')),
        diagnostics: [diagnostic(9999)],
      });
      if (fixture.diagnostics === 'other') return;
      await server.sendNotification(PublishDiagnosticsNotification.type, {
        uri: responseUri(
          fixture.diagnostics === 'wrong-case' ? uri.replace('smoke.', 'Smoke.') : uri
        ),
        diagnostics: [diagnostic(typescript ? 2322 : 'reportAssignmentType')],
      });
    });
    server.onRequest(HoverRequest.type, () => {
      return fixture.hangAtHover ? new Promise(() => {}) : { contents: 'standard library' };
    });
    server.onRequest(DefinitionRequest.type, () => {
      let target = typescript
        ? join(libraries(), 'typescript/lib/lib.es5.d.ts')
        : join(libraries(), 'pyright/dist/typeshed-fallback/stdlib/pathlib/__init__.pyi');
      if (!typescript) {
        if (fixture.definition === 'sibling') target = target.replace('stdlib', 'stdlib-other');
        if (fixture.definition === 'parent') target = join(libraries(), 'outside.pyi');
        if (fixture.definition === 'other-drive') target = target.replace(/^D:/, 'E:');
      }
      return [{ uri: responseUri(pathToFileURL(target).href), range: range() }];
    });
    server.onRequest(ShutdownRequest.type, () => null);
    server.listen();
    return child;
  },
}));

function libraries() {
  return join(
    fixture.windows ? 'D:\\Emdash' : '/opt/Emdash',
    'resources/app.asar.unpacked/node_modules'
  );
}

function assets() {
  return {
    typescript: join(libraries(), 'typescript-language-server/lib/cli.mjs'),
    compiler: join(libraries(), 'typescript/lib/tsserver.js'),
    python: join(libraries(), 'pyright/langserver.index.js'),
  };
}

function responseUri(uri: string) {
  // vscode-uri lowercases Windows drive letters and escapes the colon. Equivalent
  // encoding of the filename also exercises URI decoding on POSIX hosts.
  return uri
    .replace(/^file:\/\/\/([A-Z]):/, (_, drive: string) => `file:///${drive.toLowerCase()}%3A`)
    .replace('smoke.', '%73moke.');
}

function range() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
}

function diagnostic(code: number | string) {
  return { range: range(), code, message: 'fixture diagnostic' };
}

function verify() {
  return verifyPackagedLanguageServers({
    executable: 'fixture-electron',
    resourcesDirectory: join(fixture.windows ? 'D:\\Emdash' : '/opt/Emdash', 'resources'),
  });
}

beforeEach(() => {
  fixture.windows = false;
  fixture.diagnostics = 'matching';
  fixture.definition = 'matching';
  fixture.hangAtHover = false;
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(2_000));
});

afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
  vi.restoreAllMocks();
});

it.each([false, true])(
  'accepts equivalent file URIs for both servers (Windows: %s)',
  async (windows) => {
    fixture.windows = windows;
    await expect(verify()).resolves.toBeUndefined();
  }
);

it.each(['sibling', 'parent', 'other-drive'] as const)(
  'rejects Python definitions outside the shipped library: %s',
  async (definition) => {
    fixture.windows = true;
    fixture.definition = definition;
    await expect(verify()).rejects.toThrow(/python.*definition/);
  }
);

it.each(['other', 'wrong-case'] as const)(
  'ignores diagnostics for a different POSIX document: %s',
  async (diagnostics) => {
    fixture.diagnostics = diagnostics;
    await expect(verify()).rejects.toThrow(/typescript.*diagnostics.*TimeoutError/);
  }
);

it('includes the phase, cause and diagnostic observations when a server stalls', async () => {
  fixture.hangAtHover = true;
  await expect(verify()).rejects.toThrow(
    /typescript.*hover.*TimeoutError[\s\S]*Expected document:.*smoke.ts[\s\S]*Recent diagnostics:.*9999[\s\S]*2322/
  );
});
