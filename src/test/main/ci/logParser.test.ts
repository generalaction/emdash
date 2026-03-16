import { describe, expect, it } from 'vitest';

describe('sanitizeAndTruncateLogOutput', () => {
  it('truncates from top, prefixes warning, and strips ANSI escape codes', async () => {
    const longSegment = Array.from(
      { length: 120 },
      (_, index) => `line-${index.toString().padStart(3, '0')}`
    ).join('\n');
    const rawLog = [`\u001b[31mSTART\u001b[0m`, longSegment, 'STACKTRACE-END'].join('\n');

    const { sanitizeAndTruncateLogOutput } = await import('../../../main/services/ci/logParser');

    const parsed = sanitizeAndTruncateLogOutput(rawLog, 200);

    expect(parsed.wasTruncated).toBe(true);
    expect(parsed.output.startsWith('[Output Truncated]\n')).toBe(true);
    expect(parsed.output.includes('\u001b[')).toBe(false);
    expect(parsed.output).toContain('STACKTRACE-END');
  });
});
