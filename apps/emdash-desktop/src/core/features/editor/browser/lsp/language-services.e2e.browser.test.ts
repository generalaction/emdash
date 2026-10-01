import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { client, connect, type WireMessage, type WireTransport } from '@emdash/wire/rpc';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { encodeFacetUri } from '../../api/browser/facet-binder/facet-uri';
import { editorContract } from '../../api/contract';
import { configureMonacoLanguages } from '../monaco/monaco-config';
import { MonacoLanguageServices } from './monaco-language-services';

declare module 'vitest/browser' {
  interface BrowserCommands {
    startLspFixture(language?: 'typescript' | 'python'): Promise<{
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
configureMonacoLanguages(monaco);
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker(),
};
const token: monaco.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

it.each(['typescript', 'python'] as const)(
  'runs unsaved Monaco buffers through desktop Wire, host runtime and a real %s server',
  async (language) => {
    const python = language === 'python';
    const fixture = await commands.startLspFixture(language);
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
      python
        ? 'answer = "unsaved"\nclass Model:\n    name: str = "hello"\nitem = Model()\n'
        : 'export const answer = "unsaved";\nexport interface Model { name: string; }\nexport const item: Model = { name: "hello" };',
      language,
      monaco.Uri.parse(encodeFacetUri(fixture.source, { kind: 'buffer' }))
    );
    const consumer = monaco.editor.createModel(
      python
        ? 'from source import answer, item\nvalue: int = answer\nitem\n'
        : 'import { answer, item } from "./source";\nconst value: number = answer;\nitem;',
      language,
      monaco.Uri.parse(encodeFacetUri(fixture.consumer, { kind: 'buffer' }))
    );
    const container = document.createElement('div');
    container.style.cssText = 'width:800px;height:400px';
    document.body.appendChild(container);
    const editor = monaco.editor.create(container, { model: consumer });
    const releaseEditor = services.bindEditor(editor, context);
    const answerPosition = { lineNumber: 2, column: python ? 15 : 24 };
    const diagnosticCode = python ? 'reportAssignmentType' : '2322';
    try {
      const hover = await services.hover(consumer, answerPosition, token);
      expect(JSON.stringify(hover)).toContain('unsaved');
      const definitions = await services.definition(consumer, answerPosition, token);
      expect(definitions?.[0].uri.toString()).toBe(source.uri.toString());
      editor.setPosition(answerPosition);
      editor.focus();
      editor.trigger('keyboard', 'editor.action.revealDefinition', {});
      await expect.poll(() => opened).toContainEqual(fixture.source);

      const types = await services.typeDefinition(consumer, { lineNumber: 3, column: 2 }, token);
      expect(types?.[0].uri.toString()).toBe(source.uri.toString());
      expect(types?.[0].range.startLineNumber).toBe(2);
      const references = await services.references(
        consumer,
        answerPosition,
        { includeDeclaration: true },
        token
      );
      expect(references?.map((location) => location.uri.toString())).toContain(
        consumer.uri.toString()
      );
      expect(references?.map((location) => location.uri.toString())).toContain(
        source.uri.toString()
      );
      // Query the declaration itself so exclusion has an unambiguous target, independent of aliases.
      const usages = await services.references(
        source,
        { lineNumber: 1, column: python ? 2 : 15 },
        { includeDeclaration: false },
        token
      );
      expect(usages?.map((location) => location.uri.toString())).toContain(consumer.uri.toString());
      expect(usages?.map((location) => location.uri.toString())).not.toContain(
        source.uri.toString()
      );

      await expect
        .poll(
          () =>
            monaco.editor.getModelMarkers({ resource: consumer.uri }).map((marker) => marker.code),
          { timeout: 15_000 }
        )
        .toContain(diagnosticCode);
      source.setValue(
        python
          ? 'answer = 42\nclass Model:\n    name: str = "hello"\nitem = Model()\n'
          : 'export const answer = 42;\nexport interface Model { name: string; }\nexport const item: Model = { name: "hello" };'
      );
      await services.hover(consumer, answerPosition, token);
      await expect
        .poll(
          () =>
            monaco.editor
              .getModelMarkers({ resource: consumer.uri })
              .some((marker) => marker.code === diagnosticCode),
          { timeout: 15_000 }
        )
        .toBe(false);
      await services.restartServer(fixture.source);
      expect(JSON.stringify(await services.hover(consumer, answerPosition, token))).toContain('42');
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
  },
  30_000
);
