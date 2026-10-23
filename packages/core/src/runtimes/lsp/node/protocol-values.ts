import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { formatAbsolute, parseNativeAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import { lspRangeSchema, type LspHover, type LspLocation, type LspState } from '../api/schemas';
import type { ServerSessionState } from './server-session';

export function documentUri(value: HostAbsolutePath): string {
  if ((value.root.kind === 'posix') !== (process.platform !== 'win32'))
    throw new Error('File path belongs to a different operating system');
  return pathToFileURL(formatAbsolute(value)).href;
}

function documentPath(uri: string): HostAbsolutePath {
  const parsed = parseNativeAbsolute(fileURLToPath(uri));
  if (!parsed.success) throw new Error('Language server returned an invalid file path');
  return parsed.data;
}

export function projectSessionState(state: ServerSessionState): LspState {
  return {
    ...state,
    capabilities: {
      hover: !!state.capabilities.hoverProvider,
      definition: !!state.capabilities.definitionProvider,
      typeDefinition: !!state.capabilities.typeDefinitionProvider,
      references: !!state.capabilities.referencesProvider,
    },
    diagnostics: state.diagnostics.flatMap(({ uri, ...diagnostics }) => {
      try {
        return [{ path: documentPath(uri), ...diagnostics }];
      } catch {
        return [];
      }
    }),
  };
}

const markedString = z.union([z.string(), z.object({ language: z.string(), value: z.string() })]);

const hoverSchema = z.object({
  contents: z.union([
    markedString,
    z.array(markedString),
    z.object({ kind: z.enum(['markdown', 'plaintext']), value: z.string() }),
  ]),
  range: lspRangeSchema.optional(),
});

function markdown(value: z.infer<typeof markedString>): string {
  if (typeof value === 'string') return value;
  const fence = '`'.repeat(
    Math.max(3, ...(value.value.match(/`+/g) ?? []).map((run) => run.length + 1))
  );
  return `${fence}${value.language.replace(/[^\w+-]/g, '')}\n${value.value}\n${fence}`;
}

export function parseHover(input: unknown): LspHover {
  if (input === null) return null;
  const { contents, range } = hoverSchema.parse(input);
  const text = Array.isArray(contents)
    ? contents.map(markdown).join('\n\n')
    : typeof contents === 'object' && 'kind' in contents
      ? contents.kind === 'plaintext'
        ? markdown({ language: '', value: contents.value })
        : contents.value
      : markdown(contents);
  return { contents: text, ...(range ? { range } : {}) };
}

const locationSchema = z.union([
  z.object({ uri: z.string(), range: lspRangeSchema }),
  z.object({
    targetUri: z.string(),
    targetRange: lspRangeSchema,
    targetSelectionRange: lspRangeSchema,
    originSelectionRange: lspRangeSchema.optional(),
  }),
]);

export function parseLocations(input: unknown): LspLocation[] {
  if (input === null) return [];
  return z
    .array(locationSchema)
    .parse(Array.isArray(input) ? input : [input])
    .flatMap((location) => {
      try {
        return 'uri' in location
          ? [{ path: documentPath(location.uri), range: location.range }]
          : [
              {
                path: documentPath(location.targetUri),
                range: location.targetSelectionRange,
                originRange: location.originSelectionRange,
              },
            ];
      } catch {
        return [];
      }
    });
}
