import { describe, expect, it } from 'vitest';
import { classifySelectionLink, parseFileLinkText } from './selection-link';

describe('classifySelectionLink', () => {
  it('classifies a selection containing a URL with the extracted URL', () => {
    expect(classifySelectionLink('error: see https://example.com/a?b=1 for details')).toEqual({
      kind: 'url',
      url: 'https://example.com/a?b=1',
    });
  });

  it('classifies http URLs', () => {
    expect(classifySelectionLink('http://localhost:3000/path')).toEqual({
      kind: 'url',
      url: 'http://localhost:3000/path',
    });
  });

  it('classifies Unix absolute file paths without line suffixes', () => {
    expect(classifySelectionLink('/tmp/output/report.md')).toEqual({
      kind: 'file',
      rawPath: '/tmp/output/report.md',
      path: '/tmp/output/report.md',
      line: undefined,
    });
  });

  it('classifies home-relative paths', () => {
    expect(classifySelectionLink('~/notes/todo.md')).toEqual({
      kind: 'file',
      rawPath: '~/notes/todo.md',
      path: '~/notes/todo.md',
      line: undefined,
    });
  });

  it('classifies relative paths with extensions', () => {
    expect(classifySelectionLink('src/app.ts')).toEqual({
      kind: 'file',
      rawPath: 'src/app.ts',
      path: 'src/app.ts',
      line: undefined,
    });
  });

  it('strips a :line suffix and reports the line', () => {
    expect(classifySelectionLink('src/app.ts:42')).toEqual({
      kind: 'file',
      rawPath: 'src/app.ts:42',
      path: 'src/app.ts',
      line: 42,
    });
  });

  it('strips a :line:col suffix', () => {
    expect(classifySelectionLink('/repo/src/app.ts:42:10')).toEqual({
      kind: 'file',
      rawPath: '/repo/src/app.ts:42:10',
      path: '/repo/src/app.ts',
      line: 42,
    });
  });

  it('classifies Windows absolute paths', () => {
    expect(classifySelectionLink('C:\\repo\\src\\app.ts')).toEqual({
      kind: 'file',
      rawPath: 'C:\\repo\\src\\app.ts',
      path: 'C:\\repo\\src\\app.ts',
      line: undefined,
    });
  });

  it('ignores leading and trailing whitespace', () => {
    expect(classifySelectionLink('  src/app.ts  ')).toEqual({
      kind: 'file',
      rawPath: 'src/app.ts',
      path: 'src/app.ts',
      line: undefined,
    });
  });

  it('returns other for plain prose', () => {
    expect(classifySelectionLink('just some words here')).toEqual({ kind: 'other' });
  });

  it('returns other for empty text', () => {
    expect(classifySelectionLink('   ')).toEqual({ kind: 'other' });
  });

  it('returns other for multi-word text without a path shape', () => {
    expect(classifySelectionLink('word another word')).toEqual({ kind: 'other' });
  });

  it('keeps URLs classified as URLs even when they end in a path-like suffix', () => {
    expect(classifySelectionLink('https://example.com/src/file.ts')).toEqual({
      kind: 'url',
      url: 'https://example.com/src/file.ts',
    });
  });
});

describe('parseFileLinkText', () => {
  it('keeps paths without digits intact', () => {
    expect(parseFileLinkText('src/app.ts')).toEqual({ path: 'src/app.ts', line: undefined });
  });

  it('does not strip a Windows drive-letter colon', () => {
    expect(parseFileLinkText('C:\\repo\\src\\app.ts')).toEqual({
      path: 'C:\\repo\\src\\app.ts',
      line: undefined,
    });
  });

  it('does not treat bare numbers as line suffixes', () => {
    expect(parseFileLinkText('42')).toEqual({ path: '42', line: undefined });
  });

  it('trims surrounding whitespace', () => {
    expect(parseFileLinkText('  src/app.ts:7  ')).toEqual({ path: 'src/app.ts', line: 7 });
  });
});
