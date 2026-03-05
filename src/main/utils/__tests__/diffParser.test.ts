import { describe, it, expect } from 'vitest';
import {
  parseDiffLines,
  stripTrailingNewline,
  MAX_DIFF_CONTENT_BYTES,
  MAX_DIFF_OUTPUT_BYTES,
} from '../diffParser';

describe('parseDiffLines', () => {
  it('should parse a standard unified diff', () => {
    const stdout =
      'diff --git a/file.ts b/file.ts\n' +
      'index abc..def 100644\n' +
      '--- a/file.ts\n' +
      '+++ b/file.ts\n' +
      '@@ -1,3 +1,3 @@\n' +
      ' hello\n' +
      '-old line\n' +
      '+new line\n' +
      ' world\n';

    const { lines, isBinary } = parseDiffLines(stdout);

    expect(isBinary).toBe(false);
    expect(lines).toEqual([
      { left: 'hello', right: 'hello', type: 'context' },
      { left: 'old line', type: 'del' },
      { right: 'new line', type: 'add' },
      { left: 'world', right: 'world', type: 'context' },
    ]);
  });

  it('should skip all extended diff headers', () => {
    const stdout =
      'diff --git a/file.ts b/file.ts\n' +
      'new file mode 100644\n' +
      'old file mode 100755\n' +
      'deleted file mode 100644\n' +
      'similarity index 95%\n' +
      'rename from old.ts\n' +
      'rename to new.ts\n' +
      'index abc..def 100644\n' +
      '--- a/file.ts\n' +
      '+++ b/file.ts\n' +
      '@@ -1 +1 @@\n' +
      '+content\n';

    const { lines } = parseDiffLines(stdout);
    expect(lines).toEqual([{ right: 'content', type: 'add' }]);
  });

  it('should skip "No newline at end of file" markers', () => {
    const stdout =
      'diff --git a/f b/f\n' +
      '--- a/f\n' +
      '+++ b/f\n' +
      '@@ -1 +1 @@\n' +
      '-old\n' +
      '\\ No newline at end of file\n' +
      '+new\n' +
      '\\ No newline at end of file\n';

    const { lines } = parseDiffLines(stdout);
    expect(lines).toEqual([
      { left: 'old', type: 'del' },
      { right: 'new', type: 'add' },
    ]);
  });

  it('should detect binary files', () => {
    const stdout =
      'diff --git a/img.png b/img.png\n' +
      'index abc..def 100644\n' +
      'Binary files a/img.png and b/img.png differ\n';

    const { lines, isBinary } = parseDiffLines(stdout);
    expect(isBinary).toBe(true);
    expect(lines).toEqual([]);
  });

  it('should return empty for empty input', () => {
    const { lines, isBinary } = parseDiffLines('');
    expect(lines).toEqual([]);
    expect(isBinary).toBe(false);
  });

  it('should treat unrecognized prefix lines as context with full line', () => {
    const { lines } = parseDiffLines('some unexpected line\n');
    expect(lines).toEqual([
      { left: 'some unexpected line', right: 'some unexpected line', type: 'context' },
    ]);
  });
});

describe('stripTrailingNewline', () => {
  it('should strip one trailing newline', () => {
    expect(stripTrailingNewline('hello\n')).toBe('hello');
  });

  it('should strip only one trailing newline', () => {
    expect(stripTrailingNewline('hello\n\n')).toBe('hello\n');
  });

  it('should return unchanged if no trailing newline', () => {
    expect(stripTrailingNewline('hello')).toBe('hello');
  });

  it('should handle empty string', () => {
    expect(stripTrailingNewline('')).toBe('');
  });
});

describe('MAX_DIFF_CONTENT_BYTES', () => {
  it('should be 512KB', () => {
    expect(MAX_DIFF_CONTENT_BYTES).toBe(512 * 1024);
  });
});

describe('MAX_DIFF_OUTPUT_BYTES', () => {
  it('should be 10MB', () => {
    expect(MAX_DIFF_OUTPUT_BYTES).toBe(10 * 1024 * 1024);
  });
});
