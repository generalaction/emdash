import { describe, expect, it } from 'vitest';
import {
  buildExplainPrompt,
  MAX_AI_ANNOTATION_BODY_LENGTH,
  MAX_AI_ANNOTATIONS,
  parseAiAnnotations,
  resolveAnnotationLine,
} from './ai-annotations';

const allowed = new Set(['src/a.ts']);

function reply(payload: unknown): string {
  return `Here is the explanation.\n<emdash-annotations>\n${JSON.stringify(payload)}\n</emdash-annotations>`;
}

describe('parseAiAnnotations', () => {
  it('parses a valid block', () => {
    const result = parseAiAnnotations(
      reply([{ path: 'src/a.ts', line: 3, lineContent: 'const x = 1;', body: 'Sets x.' }]),
      allowed
    );
    expect(result).toEqual([
      { path: 'src/a.ts', lineNumber: 3, lineContent: 'const x = 1;', body: 'Sets x.' },
    ]);
  });

  it('accepts JSON wrapped in a code fence', () => {
    const text =
      '<emdash-annotations>\n```json\n[{"path":"src/a.ts","line":1,"lineContent":"","body":"b"}]\n```\n</emdash-annotations>';
    expect(parseAiAnnotations(text, allowed)).toHaveLength(1);
  });

  it('returns nothing when the block is missing', () => {
    expect(parseAiAnnotations('No annotations here.', allowed)).toEqual([]);
  });

  it('returns nothing for malformed JSON', () => {
    expect(parseAiAnnotations('<emdash-annotations>[{oops</emdash-annotations>', allowed)).toEqual(
      []
    );
  });

  it('drops entries for paths outside the diff', () => {
    const result = parseAiAnnotations(
      reply([
        { path: '/etc/passwd', line: 1, lineContent: '', body: 'nope' },
        { path: './src/a.ts', line: 2, lineContent: '', body: 'yes' },
      ]),
      allowed
    );
    expect(result.map((annotation) => annotation.lineNumber)).toEqual([2]);
  });

  it('drops invalid entries without rejecting valid ones', () => {
    const result = parseAiAnnotations(
      reply([
        { path: 'src/a.ts', line: -1, lineContent: '', body: 'bad' },
        { path: 'src/a.ts', line: 4, lineContent: '', body: 'ok' },
      ]),
      allowed
    );
    expect(result.map((annotation) => annotation.lineNumber)).toEqual([4]);
  });

  it('caps the number of entries and body length', () => {
    const many = Array.from({ length: MAX_AI_ANNOTATIONS + 5 }, (_, index) => ({
      path: 'src/a.ts',
      line: index + 1,
      lineContent: '',
      body: 'x'.repeat(MAX_AI_ANNOTATION_BODY_LENGTH + 10),
    }));
    const result = parseAiAnnotations(reply(many), allowed);
    expect(result).toHaveLength(MAX_AI_ANNOTATIONS);
    expect(result[0]?.body).toHaveLength(MAX_AI_ANNOTATION_BODY_LENGTH);
  });

  it('drops entries without lineContent', () => {
    expect(parseAiAnnotations(reply([{ path: 'src/a.ts', line: 1, body: 'b' }]), allowed)).toEqual(
      []
    );
  });

  it('uses the last block when the reply contains several', () => {
    const text = `${reply([{ path: 'src/a.ts', line: 1, lineContent: '', body: 'old' }])}\n${reply([{ path: 'src/a.ts', line: 9, lineContent: '', body: 'new' }])}`;
    expect(parseAiAnnotations(text, allowed).map((annotation) => annotation.body)).toEqual(['new']);
  });
});

describe('resolveAnnotationLine', () => {
  const lines = ['import a;', 'const x = 1;', '', 'export { x };'];
  const getLine = (lineNumber: number) => lines[lineNumber - 1] ?? '';

  it('keeps the anchored line when content matches', () => {
    expect(resolveAnnotationLine({ lineNumber: 2, lineContent: 'const x = 1;' }, 4, getLine)).toBe(
      2
    );
  });

  it('re-anchors to a nearby line with matching content', () => {
    expect(
      resolveAnnotationLine({ lineNumber: 1, lineContent: '  const x = 1;' }, 4, getLine)
    ).toBe(2);
  });

  it('hides the annotation when the content no longer exists nearby', () => {
    expect(resolveAnnotationLine({ lineNumber: 2, lineContent: 'const y = 2;' }, 4, getLine)).toBe(
      null
    );
  });
});

describe('buildExplainPrompt', () => {
  it('names the staged diff command for staged targets', () => {
    const { text, hiddenContext } = buildExplainPrompt({
      kind: 'working-tree',
      group: 'staged',
      path: 'src/a.ts',
    });
    expect(text).toContain('src/a.ts');
    expect(hiddenContext).toContain('git diff --cached -- src/a.ts');
    expect(hiddenContext).toContain('<emdash-annotations>');
  });
  it('tells the agent what to do when the diff is empty for untracked files', () => {
    const { hiddenContext } = buildExplainPrompt({
      kind: 'working-tree',
      group: 'disk',
      path: 'new.ts',
    });
    expect(hiddenContext).toContain('untracked');
  });
});
