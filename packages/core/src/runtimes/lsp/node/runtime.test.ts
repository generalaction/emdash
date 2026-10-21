import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createScope } from '@emdash/shared/concurrency';
import type { ContractClient } from '@emdash/wire/rpc';
import { observe, remote } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNativeAbsolute } from '#primitives/path/api';
import { lspContract } from '../api/contract';
import { lspDocumentSchema } from '../api/schemas';
import type { LspSessionKey, LspState } from '../api/schemas';
import { createLspController } from './controller';
import { LspRuntime } from './runtime';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function absolute(value: string) {
  const parsed = parseNativeAbsolute(value);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

async function attach(
  client: ContractClient<typeof lspContract>['session'],
  key: LspSessionKey,
  listener: (state: LspState | undefined) => void = () => {}
) {
  const model = remote(lspContract.session, client, { lingerMs: 0 });
  const scope = createScope();
  scope.add(model.retain(key));
  const state = model(key).states.current;
  observe(state, (snapshot) => listener(snapshot.value), { scope });
  await state.refresh();
  return async () => {
    await scope.dispose();
    await model.dispose();
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-wire-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true } })
  );
  await writeFile(path.join(root, 'a.ts'), 'export const answer = 42;');
  const scope = createScope();
  cleanups.push(() => scope.dispose());
  const resolve = createRequire(import.meta.url).resolve;
  const runtime = new LspRuntime({
    scope,
    lingerMs: 0,
    resolveServer: async () => ({
      command: process.execPath,
      args: [resolve('typescript-language-server/lib/cli.mjs'), '--stdio'],
      env: process.env,
      initializationOptions: { tsserver: { path: resolve('typescript/lib/tsserver.js') } },
    }),
  });
  const wire = createTestWire(lspContract, createLspController(runtime), { validate: 'full' });
  cleanups.push(() => wire.dispose());
  const session = {
    clientId: 'test-client',
    root: absolute(root),
    serverId: 'typescript' as const,
  };
  const document = {
    path: absolute(path.join(root, 'a.ts')),
    languageId: 'typescript',
    version: 1,
    text: 'export const answer = "unsaved";',
  };
  return { runtime, wire, root, session, document };
}

describe('LSP runtime over Wire', () => {
  it.each(['saved 😀\r\n', ''])(
    'carries saved content over Wire and stdio while retaining the newer overlay: %j',
    async (savedText) => {
      const root = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-save-'));
      cleanups.push(() => rm(root, { recursive: true, force: true }));
      const file = path.join(root, 'a.ts');
      await writeFile(file, savedText);
      const protocol = pathToFileURL(
        createRequire(import.meta.url).resolve('vscode-languageserver-protocol/node.js')
      ).href;
      // A protocol peer observes the real notifications rather than mocking runtime methods.
      const source = `
      import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from ${JSON.stringify(protocol)};
      import { readFile } from 'node:fs/promises';
      const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
      let overlay, saved, uri;
      connection.onRequest('initialize', () => ({ capabilities: {
        hoverProvider: true, textDocumentSync: { openClose: true, change: 1, save: { includeText: true } }
      } }));
      connection.onNotification('textDocument/didOpen', ({ textDocument }) => { overlay = textDocument.text; uri = textDocument.uri; });
      connection.onNotification('textDocument/didChange', ({ contentChanges }) => { overlay = contentChanges.at(-1).text; });
      connection.onNotification('textDocument/didSave', ({ text }) => { saved = text; });
      connection.onRequest('textDocument/hover', async () => ({ contents: JSON.stringify({ saved, overlay, disk: await readFile(new URL(uri), 'utf8') }) }));
      connection.onRequest('shutdown', () => null);
      connection.onNotification('exit', () => process.exit(0));
      connection.listen();
    `;
      const scope = createScope();
      cleanups.push(() => scope.dispose());
      const runtime = new LspRuntime({
        scope,
        lingerMs: 0,
        resolveServer: async () => ({
          command: process.execPath,
          args: ['--input-type=module', '-e', source],
          env: process.env,
        }),
      });
      const wire = createTestWire(lspContract, createLspController(runtime), { validate: 'full' });
      cleanups.push(() => wire.dispose());
      const session = { clientId: 'save', root: absolute(root), serverId: 'typescript' };
      cleanups.push(await attach(wire.client.session, session));
      const document = {
        path: absolute(file),
        languageId: 'typescript',
        version: 1,
        text: savedText,
      };
      expect((await wire.client.setDocumentSnapshot({ session, document })).success).toBe(true);
      expect(
        (
          await wire.client.setDocumentSnapshot({
            session,
            document: { ...document, version: 2, text: 'newer unsaved' },
          })
        ).success
      ).toBe(true);
      expect(
        (await wire.client.documentSaved({ session, path: document.path, text: savedText })).success
      ).toBe(true);
      const result = await wire.client.hover({
        session,
        path: document.path,
        version: 2,
        position: { line: 0, character: 0 },
      });
      expect(result.success).toBe(true);
      if (!result.success || !result.data) throw new Error('Expected protocol response');
      expect(JSON.parse(result.data.contents)).toEqual({
        saved: savedText,
        disk: savedText,
        overlay: 'newer unsaved',
      });
    }
  );

  it('preserves reference options on dedicated navigation operations', async () => {
    const { wire, session, document } = await fixture();
    cleanups.push(await attach(wire.client.session, session));
    await wire.client.setDocumentSnapshot({ session, document });
    const query = {
      session,
      path: document.path,
      version: 1,
      position: { line: 0, character: 15 },
    };
    const definition = await wire.client.definition(query);
    expect(definition.success && definition.data[0]?.path).toEqual(document.path);
    const included = await wire.client.references({ ...query, includeDeclaration: true });
    expect(included.success && included.data).toHaveLength(1);
    expect(await wire.client.references({ ...query, includeDeclaration: false })).toEqual({
      success: true,
      data: [],
    });
  });
  it('identifies stale queries without failing the server', async () => {
    const { wire, session, document } = await fixture();
    const states: LspState[] = [];
    cleanups.push(
      await attach(wire.client.session, session, (state) => {
        if (state) states.push(state);
      })
    );
    await wire.client.setDocumentSnapshot({ session, document });
    const result = await wire.client.hover({
      session,
      path: document.path,
      version: 0,
      position: { line: 0, character: 15 },
    });
    expect(result).toMatchObject({ success: false, error: { type: 'stale-query' } });
    expect(states.at(-1)?.phase).toBe('ready');
  });

  it('resolves project roots without starting a language process', async () => {
    const { runtime, wire, session, document } = await fixture();
    expect(
      await wire.client.resolveProjectRoot({
        workspaceRoot: session.root,
        path: document.path,
        serverId: session.serverId,
      })
    ).toEqual({ success: true, data: session.root });
    expect(runtime.sessionCount).toBe(0);
  });
  it('applies deltas through Wire and recovers a lost acknowledgement using a snapshot', async () => {
    const { wire, session, document } = await fixture();
    cleanups.push(await attach(wire.client.session, session));
    await wire.client.setDocumentSnapshot({ session, document });
    const change = {
      path: document.path,
      baseVersion: 1,
      version: 2,
      edit: { start: document.text.indexOf('"'), deleteCount: '"unsaved"'.length, text: '42' },
    };
    expect(await wire.client.applyDocumentEdit({ session, change })).toEqual({
      success: true,
      data: undefined,
    });
    expect(await wire.client.applyDocumentEdit({ session, change })).toMatchObject({
      success: false,
      error: { type: 'document-out-of-sync' },
    });
    expect(
      await wire.client.setDocumentSnapshot({
        session,
        document: { ...document, version: 2, text: 'export const answer = 42;' },
      })
    ).toEqual({ success: true, data: undefined });
    const query = {
      session,
      path: document.path,
      version: 2,
      position: { line: 0, character: 15 },
    };
    expect(JSON.stringify(await wire.client.hover(query))).toContain('42');
    await wire.client.restartServer(session);
    expect(JSON.stringify(await wire.client.hover(query))).toContain('42');
  }, 20_000); // Starts and indexes a real TypeScript server twice, including on slower CI hosts.
  it('requires a live session lease and releases its process after the last detach', async () => {
    const { runtime, wire, session, document } = await fixture();
    expect(await wire.client.setDocumentSnapshot({ session, document })).toMatchObject({
      success: false,
      error: { type: 'session-unavailable' },
    });
    const unsubscribe = await attach(wire.client.session, session);
    expect(await wire.client.setDocumentSnapshot({ session, document })).toEqual({
      success: true,
      data: undefined,
    });
    const result = await wire.client.hover({
      session,
      path: document.path,
      version: 1,
      position: { line: 0, character: 15 },
    });
    expect(result.success && result.data?.contents).toContain('unsaved');
    await unsubscribe();
    await expect.poll(() => runtime.sessionCount).toBe(0);
  }, 20_000);

  it('keeps two clients editing the same path isolated', async () => {
    const { wire, session, document } = await fixture();
    const other = { ...session, clientId: 'other-client' };
    const subscriptions = await Promise.all(
      [session, other].map((key) => attach(wire.client.session, key))
    );
    cleanups.push(() => Promise.all(subscriptions.map((unsubscribe) => unsubscribe())));
    await Promise.all([
      wire.client.setDocumentSnapshot({ session, document }),
      wire.client.setDocumentSnapshot({
        session: other,
        document: { ...document, text: 'export const answer = true;' },
      }),
    ]);
    const results = await Promise.all(
      [session, other].map((key) =>
        wire.client.hover({
          session: key,
          path: document.path,
          version: 1,
          position: { line: 0, character: 15 },
        })
      )
    );
    expect(JSON.stringify(results[0])).toContain('unsaved');
    expect(JSON.stringify(results[1])).toContain('true');
    expect(JSON.stringify(results[1])).not.toContain('unsaved');
  }, 20_000);

  it('keeps missing tooling a session failure rather than a worker failure', async () => {
    const scope = createScope();
    cleanups.push(() => scope.dispose());
    const runtime = new LspRuntime({
      scope,
      resolveServer: async () => {
        throw new Error('Install TypeScript language server on this host');
      },
    });
    const wire = createTestWire(lspContract, createLspController(runtime));
    cleanups.push(() => wire.dispose());
    const session = {
      clientId: 'missing',
      root: absolute(tmpdir()),
      serverId: 'typescript' as const,
    };
    const states: string[] = [];
    const unsubscribe = await attach(wire.client.session, session, (state) => {
      if (state) states.push(JSON.stringify(state));
    });
    cleanups.push(unsubscribe);
    await expect
      .poll(() => states.some((state) => state.includes('Install TypeScript')))
      .toBe(true);
  });

  it('rejects oversized buffers and invalid versions before they reach a server', () => {
    const base = { path: absolute('/a.ts'), languageId: 'typescript', text: '', version: 1 };
    expect(lspDocumentSchema.safeParse({ ...base, version: -1 }).success).toBe(false);
    expect(lspDocumentSchema.safeParse({ ...base, text: 'a'.repeat(2_000_001) }).success).toBe(
      false
    );
  });
});
