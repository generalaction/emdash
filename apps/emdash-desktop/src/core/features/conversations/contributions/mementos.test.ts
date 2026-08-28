import { describe, expect, it } from 'vitest';
import {
  ACP_DRAFT_MAX_LENGTH,
  acpDraftMemento,
  acpDraftSchema,
  providerPreferencesMemento,
  providerPreferencesSchema,
} from './mementos';

describe('ACP draft memento', () => {
  it('retains up to 5000 conversation drafts for 90 days', () => {
    expect(acpDraftMemento.retention).toEqual({
      tier: 'persisted',
      maxAge: 90 * 24 * 60 * 60 * 1_000,
      maxEntries: 5_000,
    });
  });

  it('stores bounded text and attachment refs without attachment bytes', () => {
    const value = {
      version: '1' as const,
      text: 'a'.repeat(ACP_DRAFT_MAX_LENGTH),
      attachments: [{ id: 'attachment-1', mimeType: 'image/png' as const, name: 'image.png' }],
    };

    expect(acpDraftSchema.schema.safeParse(value).success).toBe(true);
    expect(acpDraftSchema.parseJson(acpDraftSchema.serialize(value))).toEqual(value);
    expect(
      acpDraftSchema.schema.safeParse({
        ...value,
        text: 'a'.repeat(ACP_DRAFT_MAX_LENGTH + 1),
      }).success
    ).toBe(false);
    expect(
      acpDraftSchema.schema.safeParse({
        ...value,
        attachments: [{ id: 'attachment-1', mimeType: 'text/plain', bytes: [1, 2, 3] }],
      }).success
    ).toBe(false);
  });
});

describe('provider preferences memento', () => {
  it('stores provider-native selections without expiring', () => {
    expect(
      providerPreferencesSchema.safeParse({
        version: '1',
        entries: {
          '["local","claude","acp"]': {
            model: 'sonnet',
            modeId: 'agent-full-access',
            effort: 'high',
          },
        },
      }).status
    ).toBe('ok');
    expect(providerPreferencesMemento.retention).toEqual({
      tier: 'persisted',
      maxAge: Number.MAX_SAFE_INTEGER,
      maxEntries: 1,
    });
  });
});
