import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { isOk } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { makeAcpHarness, makeStartInput } from '../acp-test-support';
import { sessionConfigStateSchema } from '../models/config';
import { sessionStateSchema } from '../models/session';
import { transcriptTurnSchema } from '../models/turns';
import { AcpTranscriptParser } from '../reducer/parser';
import { AcpRuntime } from '../runtime/runtime';
import { historyPageSchema } from './queries';

type FixtureFile = {
  events: Array<{
    ts?: number;
    event: { kind: string; update?: SessionUpdate };
  }>;
};

function loadUpdates(filename: string): Array<{ update: SessionUpdate; ts?: number }> {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '../reducer/fixtures', filename), 'utf8')
  ) as FixtureFile;
  return fixture.events.flatMap((entry) =>
    entry.event.kind === 'session_update' && entry.event.update
      ? [{ update: entry.event.update, ts: entry.ts }]
      : []
  );
}

describe('ACP API contract schemas', () => {
  it.each(['acp-claude.json', 'acp-codex.json'])(
    'parses replayed history and config for %s',
    (filename) => {
      const replay = AcpTranscriptParser.replay(loadUpdates(filename), {
        conversationId: `fixture-${filename}`,
      });

      expect(() =>
        historyPageSchema.parse({ turns: replay.committed, nextCursor: null })
      ).not.toThrow();
      expect(() => sessionConfigStateSchema.parse(replay.config)).not.toThrow();
      expect(() => transcriptTurnSchema.nullable().parse(replay.active)).not.toThrow();
    }
  );

  it('parses runtime live model snapshots with the public schemas', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const started = await rt.startSession(makeStartInput({ conversationId: 'conv-contract' }));
    expect(isOk(started)).toBe(true);

    const live = rt.sessionLiveModels('conv-contract');
    if (!live) throw new Error('expected live models');

    expect(() => sessionStateSchema.parse(live.sessionState.snapshot().data)).not.toThrow();
    expect(() => sessionConfigStateSchema.parse(live.config.snapshot().data)).not.toThrow();
    expect(() =>
      transcriptTurnSchema.nullable().parse(live.activeTurn.snapshot().data)
    ).not.toThrow();
  });
});
