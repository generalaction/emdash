import { describe, expect, it } from 'vitest';
import {
  SHARE_MAX_PAYLOAD_BYTES,
  sharedAutomationSchema,
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

  it('accepts valid automation payloads', () => {
    expect(
      sharePayloadSchema.parse({
        type: 'automation',
        automation: {
          name: 'Nightly triage',
          description: 'Triage new issues every night',
          category: 'maintenance',
          trigger: { expr: '0 3 * * *', tz: 'UTC' },
          actions: [{ kind: 'task.create', prompt: 'Triage all new issues.' }],
          deadlinePolicy: 'next-interval',
          deadlineMs: null,
        },
      })
    ).toMatchObject({ type: 'automation' });
  });

  it('accepts a known agent provider id and rejects unknown ones', () => {
    const automation = {
      name: 'Nightly triage',
      category: 'maintenance',
      trigger: { expr: '0 3 * * *', tz: 'UTC' },
      actions: [{ kind: 'task.create', prompt: 'Triage all new issues.' }],
      deadlinePolicy: 'none',
    };
    expect(
      sharedAutomationSchema.parse({ ...automation, agentProviderId: 'claude' })
    ).toMatchObject({ agentProviderId: 'claude' });
    expect(() =>
      sharedAutomationSchema.parse({ ...automation, agentProviderId: 'not-a-provider' })
    ).toThrow();
  });

  it('rejects automations without actions', () => {
    expect(() =>
      sharedAutomationSchema.parse({
        name: 'Nightly triage',
        category: 'maintenance',
        trigger: { expr: '0 3 * * *', tz: 'UTC' },
        actions: [],
        deadlinePolicy: 'none',
      })
    ).toThrow();
  });

  it('rejects oversized automation action prompts', () => {
    expect(() =>
      sharedAutomationSchema.parse({
        name: 'Nightly triage',
        category: 'maintenance',
        trigger: { expr: '0 3 * * *', tz: 'UTC' },
        actions: [{ kind: 'task.create', prompt: 'x'.repeat(20_001) }],
        deadlinePolicy: 'none',
      })
    ).toThrow();
  });
});
