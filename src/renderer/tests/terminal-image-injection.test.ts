import { describe, expect, it } from 'vitest';
import {
  escapePathForTerminal,
  escapeWindowsPathForTerminal,
  formatTerminalImagePaths,
  isHeicLikeFile,
  isUnstableDropPath,
  wrapAsBracketedPaste,
} from '@renderer/lib/pty/terminal-image-paths';

describe('terminal-image-injection', () => {
  it('detects unstable Chromium drop paths', () => {
    expect(isUnstableDropPath('/var/folders/xx/T/Drops/image.png')).toBe(true);
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

  it('wraps formatted paths for bracketed paste', () => {
    const payload = wrapAsBracketedPaste(formatTerminalImagePaths(['/tmp/a.png'], 'darwin'));
    expect(payload).toBe('\x1b[200~/tmp/a.png\x1b[201~');
    expect(payload.charCodeAt(0)).toBe(27);
  });
});
