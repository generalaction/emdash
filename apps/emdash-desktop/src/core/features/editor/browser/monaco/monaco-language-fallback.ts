import type * as Monaco from 'monaco-editor';
import type { DefinitionInfo, QuickInfo, ReferenceEntry } from 'typescript';
import { toMonacoRange, toProtocolPosition } from './language-coordinates';

type Model = Monaco.editor.ITextModel;
type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Markup = string | { value: string; kind?: string; language?: string };
interface LocalProtocolWorker {
  doHover(
    uri: string,
    position: Position
  ): Promise<{
    contents: Markup | Markup[];
    range?: Range;
  } | null>;
  doValidation(uri: string): Promise<
    Array<{
      range: Range;
      message: string;
      severity?: number;
      code?: number | string;
      source?: string;
    }>
  >;
  findDefinition(uri: string, position: Position): Promise<{ uri: string; range: Range } | null>;
  findReferences(uri: string, position: Position): Promise<Array<{ uri: string; range: Range }>>;
}

export const fallbackLanguageIds = [
  'typescript',
  'javascript',
  'css',
  'scss',
  'less',
  'html',
  'json',
];

/**
 * On-demand access to Monaco's bundled language workers, independent of host availability.
 * The editor chooses one answer/marker set per model; Monaco's completion and formatting
 * providers remain unchanged. No provider registration or host policy belongs here.
 */
export class MonacoLanguageFallback {
  private readonly declarations = new Set<Model>();
  private disposed = false;
  private readonly workers = new Map<
    string,
    {
      worker: Monaco.editor.MonacoWebWorker<LocalProtocolWorker>;
      timer: ReturnType<typeof setTimeout>;
      change: Monaco.IDisposable;
    }
  >();

  constructor(private readonly monaco: typeof Monaco) {}

  async hover(model: Model, position: Monaco.IPosition): Promise<Monaco.languages.Hover | null> {
    if (isTypeScript(model)) {
      const worker = await this.typescriptWorker(model);
      const info: QuickInfo | undefined = await worker.getQuickInfoAtPosition(
        model.uri.toString(),
        model.getOffsetAt(position)
      );
      if (!info) return null;
      return {
        range: spanRange(model, info.textSpan),
        contents: [
          {
            value:
              '```typescript\n' +
              (info.displayParts ?? []).map((part) => part.text).join('') +
              '\n```',
          },
          { value: (info.documentation ?? []).map((part) => part.text).join('') },
        ],
      };
    }
    if (!fallbackLanguageIds.includes(model.getLanguageId())) return null;
    const worker = await this.protocolWorker(model);
    const info = await worker.doHover(model.uri.toString(), toProtocolPosition(position));
    return info
      ? {
          range: info.range && toMonacoRange(info.range),
          contents: (Array.isArray(info.contents) ? info.contents : [info.contents]).map(markdown),
        }
      : null;
  }

  async definition(
    model: Model,
    position: Monaco.IPosition
  ): Promise<Monaco.languages.Location[] | null> {
    if (isTypeScript(model)) {
      const worker = await this.typescriptWorker(model);
      const result: readonly DefinitionInfo[] | undefined = await worker.getDefinitionAtPosition(
        model.uri.toString(),
        model.getOffsetAt(position)
      );
      return this.typescriptLocations(result, worker);
    }
    if (!isStylesheet(model)) return null;
    const worker = await this.protocolWorker(model);
    const result = await worker.findDefinition(model.uri.toString(), toProtocolPosition(position));
    return result
      ? [{ uri: this.monaco.Uri.parse(result.uri), range: toMonacoRange(result.range) }]
      : null;
  }

  async references(
    model: Model,
    position: Monaco.IPosition
  ): Promise<Monaco.languages.Location[] | null> {
    if (isTypeScript(model)) {
      const worker = await this.typescriptWorker(model);
      const result: ReferenceEntry[] | undefined = await worker.getReferencesAtPosition(
        model.uri.toString(),
        model.getOffsetAt(position)
      );
      return this.typescriptLocations(result, worker);
    }
    if (!isStylesheet(model)) return null;
    const worker = await this.protocolWorker(model);
    return (await worker.findReferences(model.uri.toString(), toProtocolPosition(position))).map(
      (item) => ({
        uri: this.monaco.Uri.parse(item.uri),
        range: toMonacoRange(item.range),
      })
    );
  }

  async diagnostics(model: Model): Promise<Monaco.editor.IMarkerData[]> {
    if (isTypeScript(model)) {
      const options = this.typescriptDefaults(model).getDiagnosticsOptions();
      if (options.onlyVisible && !model.isAttachedToEditor()) return [];
      const worker = await this.typescriptWorker(model);
      const uri = model.uri.toString();
      const diagnostics = (
        await Promise.all([
          options.noSyntaxValidation ? [] : worker.getSyntacticDiagnostics(uri),
          options.noSemanticValidation ? [] : worker.getSemanticDiagnostics(uri),
          options.noSuggestionDiagnostics ? [] : worker.getSuggestionDiagnostics(uri),
        ])
      ).flat();
      if (model.isDisposed()) return [];
      return diagnostics
        .filter((item) => !options.diagnosticCodesToIgnore?.includes(item.code))
        .map((item) => ({
          ...spanRange(model, { start: item.start ?? 0, length: item.length ?? 1 }),
          message: diagnosticMessage(item.messageText),
          code: String(item.code),
          source: item.source,
          severity: [
            this.monaco.MarkerSeverity.Warning,
            this.monaco.MarkerSeverity.Error,
            this.monaco.MarkerSeverity.Hint,
            this.monaco.MarkerSeverity.Info,
          ][item.category],
          tags: [
            ...(item.reportsUnnecessary ? [this.monaco.MarkerTag.Unnecessary] : []),
            ...(item.reportsDeprecated ? [this.monaco.MarkerTag.Deprecated] : []),
          ],
        }));
    }
    if (!isStylesheet(model) && model.getLanguageId() !== 'json') return [];
    const worker = await this.protocolWorker(model);
    return (await worker.doValidation(model.uri.toString())).map((item) => ({
      ...toMonacoRange(item.range),
      message: item.message,
      code: item.code === undefined ? undefined : String(item.code),
      source: item.source,
      severity: [
        this.monaco.MarkerSeverity.Error,
        this.monaco.MarkerSeverity.Warning,
        this.monaco.MarkerSeverity.Info,
        this.monaco.MarkerSeverity.Hint,
      ][(item.severity ?? 3) - 1],
    }));
  }

  dispose(): void {
    this.disposed = true;
    for (const model of this.declarations) model.dispose();
    this.declarations.clear();
    for (const language of this.workers.keys()) this.releaseWorker(language);
  }

  private typescriptDefaults(model: Model) {
    return model.getLanguageId() === 'typescript'
      ? this.monaco.typescript.typescriptDefaults
      : this.monaco.typescript.javascriptDefaults;
  }

  private async typescriptWorker(model: Model) {
    const getWorker =
      model.getLanguageId() === 'typescript'
        ? this.monaco.typescript.getTypeScriptWorker
        : this.monaco.typescript.getJavaScriptWorker;
    return (await getWorker())(model.uri);
  }

  private async typescriptLocations(
    items: readonly { fileName: string; textSpan: { start: number; length: number } }[] | undefined,
    worker: Monaco.typescript.TypeScriptWorker
  ): Promise<Monaco.languages.Location[] | null> {
    if (!items) return null;
    const locations: Monaco.languages.Location[] = [];
    for (const item of items) {
      if (this.disposed) break;
      const uri = this.monaco.Uri.parse(item.fileName);
      let target = this.monaco.editor.getModel(uri);
      if (!target) {
        const text =
          (await worker.getScriptText(item.fileName)) ??
          (/^\/lib\.[^/]+\.d\.ts$/.test(uri.path)
            ? await worker.getScriptText(uri.path.slice(1))
            : undefined);
        if (text === undefined || this.disposed) continue;
        target = this.monaco.editor.getModel(uri);
        if (!target) {
          target = this.monaco.editor.createModel(text, 'typescript', uri);
          this.declarations.add(target);
        }
      }
      locations.push({ uri, range: spanRange(target, item.textSpan) });
    }
    return locations;
  }

  private async protocolWorker(model: Model): Promise<LocalProtocolWorker> {
    const language = model.getLanguageId();
    let entry = this.workers.get(language);
    if (!entry) {
      const html = language === 'html';
      const json = language === 'json';
      const stylesheet =
        language === 'scss'
          ? this.monaco.css.scssDefaults
          : language === 'less'
            ? this.monaco.css.lessDefaults
            : this.monaco.css.cssDefaults;
      const defaults = json
        ? this.monaco.json.jsonDefaults
        : html
          ? this.monaco.html.htmlDefaults
          : stylesheet;
      const worker = this.monaco.createWebWorker<LocalProtocolWorker>({
        moduleId: `vs/language/${json ? 'json/jsonWorker' : html ? 'html/htmlWorker' : 'css/cssWorker'}`,
        label: language,
        createData: json
          ? {
              languageId: language,
              languageSettings: this.monaco.json.jsonDefaults.diagnosticsOptions,
              enableSchemaRequest:
                this.monaco.json.jsonDefaults.diagnosticsOptions.enableSchemaRequest,
            }
          : html
            ? { languageId: language, languageSettings: this.monaco.html.htmlDefaults.options }
            : { languageId: language, options: stylesheet.options },
      });
      entry = {
        worker,
        timer: setTimeout(() => this.releaseWorker(language), 120_000),
        change: defaults.onDidChange(() => this.releaseWorker(language)),
      };
      this.workers.set(language, entry);
    } else {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.releaseWorker(language), 120_000);
    }
    return entry.worker.withSyncedResources([model.uri]);
  }

  private releaseWorker(language: string): void {
    const entry = this.workers.get(language);
    if (!entry) return;
    this.workers.delete(language);
    clearTimeout(entry.timer);
    entry.change.dispose();
    entry.worker.dispose();
  }
}

function isTypeScript(model: Model): boolean {
  return ['typescript', 'javascript'].includes(model.getLanguageId());
}
function isStylesheet(model: Model): boolean {
  return ['css', 'scss', 'less'].includes(model.getLanguageId());
}
function spanRange(model: Model, span: { start: number; length: number }): Monaco.IRange {
  const start = model.getPositionAt(span.start);
  const end = model.getPositionAt(span.start + span.length);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}
function diagnosticMessage(value: Monaco.typescript.Diagnostic['messageText']): string {
  return typeof value === 'string'
    ? value
    : [value.messageText, ...(value.next ?? []).map(diagnosticMessage)].join('\n');
}
function markdown(value: Markup): Monaco.IMarkdownString {
  if (typeof value === 'string') return { value, isTrusted: false };
  return {
    value: value.language
      ? `\`\`\`${value.language}\n${value.value}\n\`\`\``
      : value.kind === 'plaintext'
        ? value.value.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&')
        : value.value,
    isTrusted: false,
  };
}
