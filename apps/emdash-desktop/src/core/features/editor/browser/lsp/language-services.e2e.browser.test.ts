import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { client, connect, type WireMessage, type WireTransport } from '@emdash/wire/rpc';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { encodeFacetUri } from '../../api/browser/facet-binder/facet-uri';
import { editorContract } from '../../api/contract';
import { configureMonacoTypeScript } from '../monaco/monaco-config';
import { MonacoLanguageServices } from './monaco-language-services';

declare module 'vitest/browser' {
  interface BrowserCommands {
    startLspFixture(): Promise<{
      id: string;
      root: HostFileRef;
      source: HostFileRef;
      consumer: HostFileRef;
    }>;
    stopLspFixture(id: string): Promise<void>;
  }
}
// Monaco cancels its own worker requests when a test disposes an editor.
addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof Error && event.reason.name === 'Canceled') event.preventDefault();
});
configureMonacoTypeScript(monaco);
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker(),
};
const token: monaco.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

it('runs unsaved Monaco buffers through desktop Wire, host runtime and a real TypeScript server', async () => {
  const fixture = await commands.startLspFixture();
  const disconnects = new Set<() => void>();
  const transport: WireTransport = {
    post(message) {
      void (window as unknown as Record<string, (message: WireMessage) => Promise<void>>)[
        fixture.id
      ](message);
    },
    onMessage(callback) {
      const listener = (event: Event) => callback((event as CustomEvent<WireMessage>).detail);
      window.addEventListener(fixture.id, listener);
      return () => window.removeEventListener(fixture.id, listener);
    },
    onDisconnect(callback) {
      disconnects.add(callback);
      return () => disconnects.delete(callback);
    },
  };
  const languageClient = client(editorContract, connect(transport)).lsp;
  const opened: HostFileRef[] = [];
  const services = new MonacoLanguageServices(monaco, {
    client: async () => languageClient,
    openLocation: (_context, ref) => {
      opened.push(ref);
      return true;
    },
  });
  const context = { projectId: 'project', taskId: 'task' };
  const releases = [
    services.registerContext(fixture.source, fixture.root, context),
    services.registerContext(fixture.consumer, fixture.root, context),
  ];
  const source = monaco.editor.createModel(
    'export const answer = "unsaved";\nexport interface Model { name: string; }\nexport const item: Model = { name: "hello" };',
    'typescript',
    monaco.Uri.parse(encodeFacetUri(fixture.source, { kind: 'buffer' }))
  );
  const consumer = monaco.editor.createModel(
    'import { answer, item } from "./source";\nconst value: number = answer;\nitem;',
    'typescript',
    monaco.Uri.parse(encodeFacetUri(fixture.consumer, { kind: 'buffer' }))
  );
  const container = document.createElement('div');
  container.style.cssText = 'width:800px;height:400px';
  document.body.appendChild(container);
  const editor = monaco.editor.create(container, { model: consumer });
  const releaseEditor = services.bindEditor(editor, context);
  try {
    const hover = await services.hover(consumer, { lineNumber: 2, column: 24 }, token);
    expect(JSON.stringify(hover)).toContain('unsaved');
    const definitions = await services.locations(
      'definition',
      consumer,
      { lineNumber: 2, column: 24 },
      token
    );
    expect(definitions?.[0].uri.toString()).toBe(source.uri.toString());
    editor.setPosition({ lineNumber: 2, column: 24 });
    editor.focus();
    editor.trigger('keyboard', 'editor.action.revealDefinition', {});
    await expect.poll(() => opened).toContainEqual(fixture.source);

    const types = await services.locations(
      'typeDefinition',
      consumer,
      { lineNumber: 3, column: 2 },
      token
    );
    expect(types?.[0].uri.toString()).toBe(source.uri.toString());
    expect(types?.[0].range.startLineNumber).toBe(2);
    const references = await services.locations(
      'references',
      consumer,
      { lineNumber: 2, column: 24 },
      token
    );
    expect(references?.map((location) => location.uri.toString())).toContain(
      consumer.uri.toString()
    );
    expect(references?.map((location) => location.uri.toString())).toContain(source.uri.toString());

    await expect
      .poll(
        () =>
          monaco.editor.getModelMarkers({ resource: consumer.uri }).map((marker) => marker.code),
        { timeout: 15_000 }
      )
      .toContain('2322');
    source.setValue(
      'export const answer = 42;\nexport interface Model { name: string; }\nexport const item: Model = { name: "hello" };'
    );
    await services.hover(consumer, { lineNumber: 2, column: 24 }, token);
    await expect
      .poll(
        () =>
          monaco.editor
            .getModelMarkers({ resource: consumer.uri })
            .some((marker) => marker.code === '2322'),
        { timeout: 15_000 }
      )
      .toBe(false);
    await services.restart(fixture.source);
    expect(
      JSON.stringify(await services.hover(consumer, { lineNumber: 2, column: 24 }, token))
    ).toContain('42');
  } finally {
    releaseEditor();
    editor.dispose();
    container.remove();
    await services.dispose();
    source.dispose();
    consumer.dispose();
    releases.forEach((release) => release());
    for (const disconnect of disconnects) disconnect();
    await commands.stopLspFixture(fixture.id);
  }
}, 30_000);
