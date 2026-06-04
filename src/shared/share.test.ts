import { describe, expect, it } from 'vitest';
import {
  SHARE_MAX_PAYLOAD_BYTES,
  sharedPromptSchema,
  sharedSkillSchema,
  sharePayloadSchema,
} from './share';

describe('share schemas', () => {
  it('accepts valid skill payloads', () => {
    expect(
      sharePayloadSchema.parse({
        type: 'skill',
        skill: {
          name: 'pdf-tools',
          displayName: 'PDF Tools',
          description: 'Work with PDFs',
          skillMdContent: '---\nname: pdf-tools\ndescription: Work with PDFs\n---\nDo it.',
        },
      })
    ).toMatchObject({ type: 'skill' });
  });

  it('rejects invalid skill names', () => {
    expect(() =>
      sharedSkillSchema.parse({
        name: 'PDF_Tools',
        displayName: 'PDF Tools',
        description: 'Work with PDFs',
        skillMdContent: 'content',
      })
    ).toThrow();
  });

  it('rejects oversized prompt content', () => {
    expect(() =>
      sharedPromptSchema.parse({
        title: 'Large prompt',
        prompt: 'x'.repeat(SHARE_MAX_PAYLOAD_BYTES + 1),
      })
    ).toThrow();
  });
});
