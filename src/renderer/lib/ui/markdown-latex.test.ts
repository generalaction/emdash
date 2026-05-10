import { describe, expect, it } from 'vitest';
import { normalizeLatexDelimiters } from './markdown-latex';

describe('normalizeLatexDelimiters', () => {
  it('normalizes common LaTeX inline and display delimiters', () => {
    expect(normalizeLatexDelimiters('Inline \\(x^2\\) and display:\n\\[\nx^2\n\\]')).toBe(
      'Inline $x^2$ and display:\n$$\nx^2\n$$'
    );
  });

  it('puts dollar display math delimiters on their own lines', () => {
    expect(normalizeLatexDelimiters('Before\n$$a\n\n\\iff\n\nb$$\nAfter')).toBe(
      'Before\n$$\na\n\n\\iff\n\nb\n$$\nAfter'
    );
  });

  it('does not rewrite delimiters inside code spans or fenced code blocks', () => {
    const content = ['`\\(x\\)`', '', '```md', '\\[', 'x', '\\]', '```', '', '\\(y\\)'].join('\n');

    expect(normalizeLatexDelimiters(content)).toBe(
      ['`\\(x\\)`', '', '```md', '\\[', 'x', '\\]', '```', '', '$y$'].join('\n')
    );
  });

  it('leaves unmatched delimiters untouched', () => {
    expect(normalizeLatexDelimiters('Broken \\(x')).toBe('Broken \\(x');
  });
});
