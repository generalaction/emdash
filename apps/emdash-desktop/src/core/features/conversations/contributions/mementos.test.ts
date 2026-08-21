import { describe, expect, it } from 'vitest';
import { ACP_DRAFT_MAX_LENGTH, acpDraftMemento, acpDraftSchema } from './mementos';

describe('ACP draft memento', () => {
  it('retains up to 5000 conversation drafts for 90 days', () => {
    expect(acpDraftMemento.retention).toEqual({
      tier: 'persisted',
      maxAge: 90 * 24 * 60 * 60 * 1_000,
      maxEntries: 5_000,
    });
  });

  it('rejects draft text over 64 KiB', () => {
    expect(
      acpDraftSchema.schema.safeParse({ version: '1', text: 'a'.repeat(ACP_DRAFT_MAX_LENGTH) })
        .success
    ).toBe(true);
    expect(
      acpDraftSchema.schema.safeParse({
        version: '1',
        text: 'a'.repeat(ACP_DRAFT_MAX_LENGTH + 1),
      }).success
    ).toBe(false);
  });
});
