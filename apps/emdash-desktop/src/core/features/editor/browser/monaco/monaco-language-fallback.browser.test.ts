import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { afterEach, expect, it } from 'vitest';
import { configureMonacoLanguages } from './monaco-config';
import { MonacoLanguageFallback } from './monaco-language-fallback';

self.MonacoEnvironment = {
  getWorker: (_id, label) => {
    if (['typescript', 'javascript'].includes(label)) return new tsWorker();
    if (['css', 'scss', 'less'].includes(label)) return new cssWorker();
    if (label === 'html') return new htmlWorker();
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};
configureMonacoLanguages(monaco);
addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof Error && event.reason.name === 'Canceled') event.preventDefault();
});
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});
async function fixture(language: string, text: string) {
  const service = new MonacoLanguageFallback(monaco);
  const extension = language === 'typescript' ? 'ts' : language === 'javascript' ? 'js' : language;
  const model = monaco.editor.createModel(
    text,
    language,
    monaco.Uri.parse(`file:///fallback-${crypto.randomUUID()}.${extension}`)
  );
  const editor = monaco.editor.create(document.createElement('div'), { model });
  cleanup.push(
    () => service.dispose(),
    () => model.dispose(),
    () => editor.dispose()
  );
  if (language === 'typescript' || language === 'javascript') {
    await expect
      .poll(async () => {
        try {
          const getWorker =
            language === 'typescript'
              ? monaco.typescript.getTypeScriptWorker
              : monaco.typescript.getJavaScriptWorker;
          await (
            await getWorker()
          )(model.uri);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
  }
  return { service, model };
}

it.each(['typescript', 'javascript'])(
  'preserves %s hover and navigation without a host',
  async (language) => {
    const { service, model } = await fixture(language, 'const answer = 42;\nanswer;');
    const position = { lineNumber: 2, column: 3 };
    expect(JSON.stringify(await service.hover(model, position))).toContain('answer');
    expect((await service.definition(model, position))?.[0]).toMatchObject({
      uri: model.uri,
      range: { startLineNumber: 1, startColumn: 7 },
    });
    expect(await service.references(model, position)).toHaveLength(2);
  }
);

it('keeps the existing TypeScript syntax-only diagnostic policy', async () => {
  const { service, model } = await fixture('typescript', 'const typed: number = "wrong";');
  expect((await service.diagnostics(model)).some((item) => item.code === '2322')).toBe(false);
  model.setValue('const broken = ;');
  expect(
    (await service.diagnostics(model)).some((item) => item.severity === monaco.MarkerSeverity.Error)
  ).toBe(true);
});

it.each(['css', 'scss', 'less'])(
  'preserves %s hover, references and validation',
  async (language) => {
    const { service, model } = await fixture(language, '.example { color: red; }');
    expect(JSON.stringify(await service.hover(model, { lineNumber: 1, column: 13 }))).toContain(
      'color'
    );
    expect(await service.references(model, { lineNumber: 1, column: 3 })).not.toBeNull();
    model.setValue('.example { color: }');
    expect((await service.diagnostics(model)).length).toBeGreaterThan(0);
  }
);

it('preserves HTML hover without inventing a validator', async () => {
  const { service, model } = await fixture('html', '<div></div>');
  expect(JSON.stringify(await service.hover(model, { lineNumber: 1, column: 3 }))).toContain('div');
  expect(await service.diagnostics(model)).toEqual([]);
});

it('preserves JSON syntax validation', async () => {
  const { service, model } = await fixture('json', '{ "answer": }');
  expect((await service.diagnostics(model)).length).toBeGreaterThan(0);
  model.setValue('{ "answer": 42 }');
  expect(await service.diagnostics(model)).toEqual([]);
});

it('returns no local service for languages Monaco does not supply', async () => {
  const { service, model } = await fixture('python', 'answer = 42');
  expect(await service.hover(model, { lineNumber: 1, column: 3 })).toBeNull();
  expect(await service.definition(model, { lineNumber: 1, column: 3 })).toBeNull();
  expect(await service.references(model, { lineNumber: 1, column: 3 })).toBeNull();
  expect(await service.diagnostics(model)).toEqual([]);
});
