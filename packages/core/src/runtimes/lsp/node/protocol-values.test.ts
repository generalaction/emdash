import { describe, expect, it } from 'vitest';
import { parseNativeAbsolute } from '#primitives/path/api';
import { documentUri, parseHover, parseLocations, projectSessionState } from './protocol-values';

const range = { start: { line: 1, character: 2 }, end: { line: 2, character: 3 } };
const native = process.platform === 'win32' ? 'C:\\work space\\a#b.ts' : '/work space/a#b.ts';
function absolute() {
  const result = parseNativeAbsolute(native);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

describe('language protocol boundaries', () => {
  it('round-trips spaces, reserved characters and host-native roots through file URIs', () => {
    const uri = documentUri(absolute());
    expect(uri).toContain('work%20space');
    expect(uri).toContain('a%23b.ts');
    expect(parseLocations({ uri, range })).toEqual([{ path: absolute(), range }]);
  });
  it('uses the target selection range and retains the origin of a LocationLink', () => {
    const selection = { start: range.start, end: range.start };
    expect(
      parseLocations([
        {
          targetUri: documentUri(absolute()),
          targetRange: range,
          targetSelectionRange: selection,
          originSelectionRange: range,
        },
      ])
    ).toEqual([{ path: absolute(), range: selection, originRange: range }]);
  });
  it('ignores virtual and network locations that cannot be opened as host files', () => {
    expect(
      parseLocations([
        { uri: 'untitled:virtual', range },
        { uri: 'https://example.com/a.ts', range },
      ])
    ).toEqual([]);
    expect(parseLocations(null)).toEqual([]);
  });
  it('rejects malformed locations instead of guessing coordinates', () => {
    expect(() =>
      parseLocations({ uri: 'file:///a', range: { start: { line: -1, character: 0 } } })
    ).toThrow();
  });
  it('renders marked strings and plaintext without converting literal markup to trusted HTML', () => {
    expect(
      parseHover({ contents: { kind: 'plaintext', value: '<script>x</script> ```' }, range })
    ).toEqual({ contents: '````\n<script>x</script> ```\n````', range });
    expect(
      parseHover({
        contents: ['Description', { language: 'typescript', value: 'const a: string' }],
      })?.contents
    ).toBe('Description\n\n```typescript\nconst a: string\n```');
    expect(parseHover(null)).toBeNull();
  });
  it('projects negotiated capabilities and drops diagnostics for unsupported URIs', () => {
    expect(
      projectSessionState({
        phase: 'ready',
        generation: '1',
        capabilities: {
          hoverProvider: {},
          definitionProvider: false,
          typeDefinitionProvider: true,
        },
        diagnostics: [{ uri: 'untitled:x', diagnostics: [] }],
      })
    ).toEqual({
      phase: 'ready',
      generation: '1',
      capabilities: { hover: true, definition: false, typeDefinition: true, references: false },
      diagnostics: [],
    });
  });
});
