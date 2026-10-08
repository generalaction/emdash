import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseNativeAbsolute } from '@emdash/core/primitives/path/api';
import { lspContract } from '@emdash/core/runtimes/lsp/api';
import { createLspController, LspRuntime } from '@emdash/core/runtimes/lsp/node';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { memoryTransportPair, serve, type WireMessage } from '@emdash/wire/rpc';
import { createTestWire } from '@emdash/wire/testing';
import { defineBrowserCommand } from '@vitest/browser';
import type {} from '@vitest/browser-playwright';
import { createEditorWireController } from '../../src/core/features/editor/node/wire-controller';

const running = new Map<string, () => Promise<void>>();

/** Test-only transport: Playwright bindings carry real Wire frames across the browser/Node boundary. */
export const startLspFixture = defineBrowserCommand(
  async ({ page }, language: 'typescript' | 'python' = 'typescript') => {
    const id = `lsp_${randomUUID().replaceAll('-', '')}`;
    const directory = await mkdtemp(join(tmpdir(), 'emdash-lsp-browser-'));
    const scope = createScope();
    const requireCore = createRequire(
      resolve(import.meta.dirname, '../../../../packages/core/package.json')
    );
    const extension = language === 'python' ? 'py' : 'ts';
    if (language === 'python') {
      await writeFile(join(directory, 'pyrightconfig.json'), '{"typeCheckingMode":"strict"}');
      await writeFile(join(directory, 'source.py'), 'answer = 42\n');
      await writeFile(
        join(directory, 'consumer.py'),
        'from source import answer\nvalue: int = answer\n'
      );
    } else {
      await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true } })
      );
      await writeFile(join(directory, 'source.ts'), 'export const answer = 42;');
      await writeFile(
        join(directory, 'consumer.ts'),
        'import { answer } from "./source";\nconst value: number = answer;'
      );
    }
    const runtime = new LspRuntime({
      scope,
      lingerMs: 0,
      resolveServer: async () => ({
        command: process.execPath,
        args: [
          requireCore.resolve(
            language === 'python'
              ? 'pyright/langserver.index.js'
              : 'typescript-language-server/lib/cli.mjs'
          ),
          '--stdio',
        ],
        env: process.env,
        initializationOptions:
          language === 'typescript'
            ? {
                tsserver: { path: requireCore.resolve('typescript/lib/tsserver.js') },
              }
            : undefined,
      }),
    });
    const hostWire = createTestWire(lspContract, createLspController(runtime), {
      validate: 'full',
    });
    const controller = createEditorWireController({
      runtimes: { client: async () => ok({ lsp: hostWire.client } as never) },
      editorBuffer: {
        saveBuffer: async () => {},
        clearBuffer: async () => {},
        listBuffers: async () => [],
      } as never,
    });
    const pair = memoryTransportPair();
    const stop = serve(pair.right, controller);
    let send: ((message: WireMessage) => Promise<unknown>) | undefined;
    let delivery = Promise.resolve();
    pair.left.onMessage((message) => {
      delivery = delivery.then(async () => {
        await send?.(message);
      });
      // Page shutdown can interrupt a response; fixture disposal owns cleanup.
      void delivery.catch(() => {});
    });
    await page.exposeBinding(id, ({ frame }, message: WireMessage) => {
      send = (value) =>
        frame.evaluate(
          ({ id, value }) => {
            // Executed in the browser; keep the Node program free of DOM globals.
            const target = globalThis as unknown as {
              dispatchEvent(event: unknown): void;
              CustomEvent: new (name: string, options: { detail: unknown }) => unknown;
            };
            target.dispatchEvent(new target.CustomEvent(id, { detail: value }));
          },
          { id, value }
        );
      pair.left.post(message);
    });
    const dispose = async () => {
      if (!running.delete(id)) return;
      stop();
      pair.disconnect();
      await controller.dispose?.();
      await hostWire.dispose();
      await scope.dispose();
      await rm(directory, { recursive: true, force: true });
    };
    running.set(id, dispose);
    page.once('close', () => {
      void dispose();
    });
    const ref = (path: string) => {
      const parsed = parseNativeAbsolute(path);
      if (!parsed.success) throw new Error(parsed.error.message);
      return hostFileRef(LOCAL_HOST_REF, parsed.data);
    };
    return {
      id,
      root: ref(directory),
      source: ref(join(directory, `source.${extension}`)),
      consumer: ref(join(directory, `consumer.${extension}`)),
    };
  }
);

export const stopLspFixture = defineBrowserCommand(async (_context, id: string) => {
  await running.get(id)?.();
});
