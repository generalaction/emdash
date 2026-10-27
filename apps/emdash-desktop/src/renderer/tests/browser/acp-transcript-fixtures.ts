import type {
  HistoryPage,
  TranscriptSnapshot,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';

export function transcriptSnapshot(
  activeTurn: TranscriptTurn | null = null,
  historyRevision = 0,
  lastCommittedTurnSeq: number | null = null,
  generation = 'test'
): TranscriptSnapshot {
  return { generation, historyRevision, lastCommittedTurnSeq, activeTurn };
}

export function availableHistory(
  turns: TranscriptTurn[] = [],
  historyRevision = 0,
  generation = 'test'
): Extract<HistoryPage, { kind: 'available' }> {
  return {
    kind: 'available',
    turns,
    nextCursor: null,
    position: { generation, historyRevision, lastCommittedTurnSeq: turns.at(-1)?.seq ?? null },
    coverage: { fromSeq: null, beforeSeq: null },
  };
}
