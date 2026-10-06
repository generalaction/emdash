import { describe, expect, it } from 'vitest';
import { applyDocumentEdit, computeDocumentEdit, positionAtOffset } from './document-edits';

describe('document edits', () => {
  it.each([
    ['', 'hello'],
    ['hello', ''],
    ['same', 'same'],
    ['const x = 1;', 'const x = 22;'],
    ['a\r\nb', 'a\r\nnew b'],
    ['a\r\nb', 'a\nb'],
    ['a😀b', 'a😃b'],
    ['a😀b', 'aXb'],
    ['first\rsecond\nthird', 'first\rsecond\nlast'],
  ])('round-trips %j to %j', (before, after) => {
    expect(applyDocumentEdit(before, computeDocumentEdit(before, after))).toBe(after);
  });
  it('sends only a small replacement inside a large document', () => {
    const prefix = 'x'.repeat(100_000);
    expect(computeDocumentEdit(prefix + 'old' + prefix, prefix + 'new' + prefix)).toEqual({
      start: prefix.length,
      deleteCount: 3,
      text: 'new',
    });
  });
  it('preserves text across combinations of Unicode and newline boundaries', () => {
    const pieces = ['', 'a', '\r', '\n', '\r\n', '😀', '😃'];
    const texts = pieces.flatMap((first) => pieces.map((second) => first + second));
    for (const before of texts)
      for (const after of texts)
        expect(applyDocumentEdit(before, computeDocumentEdit(before, after))).toBe(after);
  });
  it('bounds the resulting document size, not just the incoming edit size', () => {
    expect(() =>
      applyDocumentEdit('a'.repeat(2_000_000), { start: 0, deleteCount: 0, text: 'x' })
    ).toThrow(/size limit/);
  });
  it('keeps CRLF and surrogate pairs intact at edit boundaries', () => {
    expect(computeDocumentEdit('a😀b', 'a😃b')).toEqual({ start: 1, deleteCount: 2, text: '😃' });
    expect(computeDocumentEdit('a\r\nb', 'a\nb')).toEqual({ start: 1, deleteCount: 2, text: '\n' });
    expect(positionAtOffset('a\r\n😀x', 5)).toEqual({ line: 1, character: 2 });
    expect(positionAtOffset('a\rb\nc', 4)).toEqual({ line: 2, character: 0 });
  });
  it.each([
    { start: -1, deleteCount: 0 },
    { start: 4, deleteCount: 0 },
    { start: 1, deleteCount: 3 },
  ])('rejects out-of-bounds edits %o', (edit) => {
    expect(() => applyDocumentEdit('abc', { ...edit, text: 'x' })).toThrow();
  });
});
