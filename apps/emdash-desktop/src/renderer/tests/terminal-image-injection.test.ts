import { describe, expect, it } from 'vitest';
import {
  buildTerminalImageInjection,
  escapePathForTerminal,
  escapeWindowsPathForTerminal,
  extractClipboardImageFiles,
  formatTerminalImagePaths,
  isHeicLikeFile,
  isNearDuplicatePaste,
  isUnstableDropPath,
  wrapAsBracketedPaste,
} from '@core/features/terminals/api/browser/pty/terminal-image-paths';

describe('terminal-image-injection', () => {
  it('detects unstable Chromium drop paths', () => {
    expect(isUnstableDropPath('/var/folders/xx/T/Drops/image.png')).toBe(true);
    expect(isUnstableDropPath('/var/folders/xx/T/emdash-drop-123-image.png')).toBe(false);
    expect(isUnstableDropPath('/Users/me/Desktop/shot.png')).toBe(false);
  });

  it('escapes spaces without wrapping in quotes', () => {
    expect(escapePathForTerminal('/tmp/my image.png')).toBe('/tmp/my\\ image.png');
  });

  it('quotes Windows paths instead of POSIX-escaping spaces', () => {
    expect(escapeWindowsPathForTerminal('C:\\Users\\me\\my image.png')).toBe(
      '"C:\\Users\\me\\my image.png"'
    );
  });

  it('detects HEIC-like files without relying on image MIME types', () => {
    expect(isHeicLikeFile(new File([], 'photo.heic', { type: '' }))).toBe(true);
    expect(isHeicLikeFile(new File([], 'photo.png', { type: 'image/png' }))).toBe(false);
  });

  it('deduplicates identical clipboard image file items', () => {
    const file = new File(['image'], 'image.png', { type: 'image/png', lastModified: 1 });
    const clipboardData = {
      items: [
        { kind: 'file', getAsFile: () => file },
        { kind: 'file', getAsFile: () => file },
      ],
      types: ['Files'],
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboardData)).toEqual([file]);
  });

  it('collapses alternate image representations from one clipboard image', () => {
    const png = new File(['png'], 'image.png', { type: 'image/png', lastModified: 1 });
    const tiff = new File(['tiff'], 'image.tiff', { type: 'image/tiff', lastModified: 1 });
    const clipboardData = {
      items: [
        { kind: 'file', getAsFile: () => png },
        { kind: 'file', getAsFile: () => tiff },
      ],
      types: ['image/png', 'image/tiff'],
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboardData)).toEqual([png]);
  });

  it('detects near-duplicate paste paths from the same user gesture', () => {
    expect(isNearDuplicatePaste(1_000, 1_249)).toBe(true);
    expect(isNearDuplicatePaste(1_000, 1_250)).toBe(false);
    // initial ref value (0) must never be treated as a recent paste
    expect(isNearDuplicatePaste(0, 100)).toBe(false);
  });

  it('wraps formatted paths for bracketed paste', () => {
    const payload = wrapAsBracketedPaste(formatTerminalImagePaths(['/tmp/a.png'], 'darwin'));
    expect(payload).toBe('\x1b[200~/tmp/a.png\x1b[201~');
    expect(payload.charCodeAt(0)).toBe(27);
  });

  it('keeps the trailing separator inside the bracketed paste', () => {
    // Claude Code discards the pasted text when any byte follows the paste-end
    // marker in the same write, so the separator must travel inside the paste.
    const payload = buildTerminalImageInjection(['/tmp/a.png', '/tmp/b.txt'], 'darwin');
    expect(payload).toBe('\x1b[200~/tmp/a.png /tmp/b.txt \x1b[201~');
    expect(payload.endsWith('\x1b[201~')).toBe(true);
  });
});
