import { describe, expect, it } from 'vitest';
import {
  attachmentDisplayName,
  buildPromptWithAttachments,
  validateAttachments,
} from './attachments';

describe('validateAttachments', () => {
  it('passes through valid attachments and strips blank names', () => {
    expect(
      validateAttachments([
        { path: '/tmp/a.png', kind: 'image', name: 'a.png' },
        { path: '/tmp/b.ts', kind: 'file', name: '  ' },
      ])
    ).toEqual([
      { path: '/tmp/a.png', kind: 'image', name: 'a.png' },
      { path: '/tmp/b.ts', kind: 'file' },
    ]);
    expect(validateAttachments(undefined)).toEqual([]);
  });

  it('rejects bad paths and kinds', () => {
    expect(() => validateAttachments([{ path: '', kind: 'file' }])).toThrow(/Invalid attachment/);
    expect(() => validateAttachments([{ path: 'a\0b', kind: 'file' }])).toThrow(
      /Invalid attachment/
    );
    expect(() => validateAttachments([{ path: '/tmp/a', kind: 'video' as never }])).toThrow(
      /Invalid attachment kind/
    );
  });
});

describe('buildPromptWithAttachments', () => {
  it('appends attachment paths for the agent to read', () => {
    expect(
      buildPromptWithAttachments('fix this', [
        { path: '/tmp/a.ts', kind: 'file' },
        { path: '/tmp/b.png', kind: 'image' },
      ])
    ).toBe('fix this\n\nAttached files (read them from disk):\n- /tmp/a.ts\n- /tmp/b.png');
  });

  it('returns the prompt untouched without attachments', () => {
    expect(buildPromptWithAttachments('hello', [])).toBe('hello');
  });

  it('supplies a base prompt for attachment-only messages', () => {
    expect(buildPromptWithAttachments('', [{ path: '/tmp/a.ts', kind: 'file' }])).toContain(
      'Look at the attached files.'
    );
  });
});

describe('attachmentDisplayName', () => {
  it('prefers the name and falls back to the basename', () => {
    expect(
      attachmentDisplayName({ path: '/tmp/x/shot.png', kind: 'image', name: 'shot.png' })
    ).toBe('shot.png');
    expect(attachmentDisplayName({ path: '/tmp/x/shot.png', kind: 'image' })).toBe('shot.png');
  });
});
