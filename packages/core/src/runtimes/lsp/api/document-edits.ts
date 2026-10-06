import { MAX_LSP_DOCUMENT_LENGTH, type LspDocumentEdit } from './schemas';

/** One replacement between acknowledged and current text, using UTF-16 offsets. */
export function computeDocumentEdit(before: string, after: string): LspDocumentEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (splitsCharacter(before, start) || splitsCharacter(after, start)) start--;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  if (splitsCharacter(before, oldEnd) || splitsCharacter(after, newEnd)) {
    oldEnd++;
    newEnd++;
  }
  return { start, deleteCount: oldEnd - start, text: after.slice(start, newEnd) };
}

function splitsCharacter(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return (
    (previous === 13 && current === 10) ||
    (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff)
  );
}

export function applyDocumentEdit(text: string, edit: LspDocumentEdit): string {
  if (
    !Number.isInteger(edit.start) ||
    !Number.isInteger(edit.deleteCount) ||
    edit.start < 0 ||
    edit.deleteCount < 0 ||
    edit.start + edit.deleteCount > text.length ||
    splitsCharacter(text, edit.start) ||
    splitsCharacter(text, edit.start + edit.deleteCount)
  ) {
    throw new Error('Document edit is outside valid text boundaries');
  }
  if (text.length - edit.deleteCount + edit.text.length > MAX_LSP_DOCUMENT_LENGTH)
    throw new Error('Document edit exceeds the language-service size limit');
  return text.slice(0, edit.start) + edit.text + text.slice(edit.start + edit.deleteCount);
}

export function positionAtOffset(text: string, offset: number) {
  let line = 0;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\r' || text[i] === '\n') {
      if (text[i] === '\r' && text[i + 1] === '\n') i++;
      line++;
      start = i + 1;
    }
  }
  return { line, character: offset - start };
}
