import { describe, expect, it } from 'vitest';
import { isMarkdownFile } from '../../renderer/constants/file-explorer';

describe('isMarkdownFile', () => {
  it('returns true for .md files', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('path/to/docs/guide.md')).toBe(true);
  });

  it('returns true for .mdx files', () => {
    expect(isMarkdownFile('component.mdx')).toBe(true);
  });

  it('returns false for non-markdown files', () => {
    expect(isMarkdownFile('index.ts')).toBe(false);
    expect(isMarkdownFile('style.css')).toBe(false);
    expect(isMarkdownFile('image.png')).toBe(false);
  });

  it('returns false for files with no extension', () => {
    expect(isMarkdownFile('Makefile')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isMarkdownFile('README.MD')).toBe(true);
    expect(isMarkdownFile('notes.Md')).toBe(true);
  });
});
