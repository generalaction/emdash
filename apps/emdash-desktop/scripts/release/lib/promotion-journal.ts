import type { ObjectPromotionSnapshot } from './object-promotion.ts';

export interface PromotionJournalIdentity {
  tag: string;
  runId: string;
  sha: string;
}

interface SerializedPromotionJournal {
  schemaVersion: 1;
  identity: PromotionJournalIdentity;
  roots: Array<{ key: string; value: string | null }>;
}

export function serializePromotionJournal(
  identity: PromotionJournalIdentity,
  snapshot: ObjectPromotionSnapshot<string>,
  expectedKeys: readonly string[]
): string {
  const roots = expectedKeys.map((key) => {
    if (!snapshot.has(key)) throw new Error(`Promotion snapshot is missing root ${key}`);
    return { key, value: snapshot.get(key) ?? null };
  });
  return JSON.stringify({ schemaVersion: 1, identity, roots } satisfies SerializedPromotionJournal);
}

export function parsePromotionJournal(
  content: string,
  expectedIdentity: PromotionJournalIdentity,
  expectedKeys: readonly string[]
): Map<string, string | null> {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object') throw new Error('Promotion journal must be an object');
  const journal = parsed as Partial<SerializedPromotionJournal>;
  if (journal.schemaVersion !== 1 || !journal.identity || !Array.isArray(journal.roots)) {
    throw new Error('Promotion journal has an unsupported schema');
  }
  if (
    journal.identity.tag !== expectedIdentity.tag ||
    journal.identity.runId !== expectedIdentity.runId ||
    journal.identity.sha !== expectedIdentity.sha
  ) {
    throw new Error('Promotion journal belongs to a different release run');
  }

  const roots = new Map<string, string | null>();
  for (const entry of journal.roots) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.key !== 'string' ||
      (typeof entry.value !== 'string' && entry.value !== null)
    ) {
      throw new Error('Promotion journal contains an invalid root entry');
    }
    if (roots.has(entry.key)) throw new Error(`Promotion journal repeats root ${entry.key}`);
    roots.set(entry.key, entry.value);
  }

  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !roots.has(key));
  const unexpected = [...roots.keys()].filter((key) => !expected.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Promotion journal root set mismatch (missing: ${missing.join(', ') || 'none'}; ` +
        `unexpected: ${unexpected.join(', ') || 'none'})`
    );
  }
  return roots;
}
