import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedNativeChatTranscript } from './transcript-store';

const mocks = vi.hoisted(() => ({
  userDataDir: '',
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userDataDir },
}));

import {
  deleteNativeChatTranscript,
  loadNativeChatTranscript,
  saveNativeChatTranscript,
} from './transcript-store';

const TRANSCRIPT: PersistedNativeChatTranscript = {
  version: 1,
  providerId: 'codex',
  items: [
    { kind: 'user_message', key: 't1:user', text: 'hello' },
    { kind: 'agent_message', key: 't1:item_0', text: 'hi' },
  ],
  turnSeq: 1,
  turnDurationsMs: { t1: 900 },
  threadId: '019e966e-a5fc-7600-a34d-624266ca1dca',
};

describe('native chat transcript store', () => {
  beforeEach(() => {
    mocks.userDataDir = mkdtempSync(join(tmpdir(), 'emdash-transcripts-'));
  });

  it('round-trips a transcript through save and load', async () => {
    await saveNativeChatTranscript('conv-1', TRANSCRIPT);
    await expect(loadNativeChatTranscript('conv-1')).resolves.toEqual(TRANSCRIPT);
  });

  it('returns null for missing, corrupt, and wrong-version files', async () => {
    await expect(loadNativeChatTranscript('missing')).resolves.toBeNull();

    await saveNativeChatTranscript('conv-1', TRANSCRIPT);
    const file = join(mocks.userDataDir, 'native-chat-transcripts', 'conv-1.json');
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw).version).toBe(1);

    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, 'not json', 'utf8');
    await expect(loadNativeChatTranscript('conv-1')).resolves.toBeNull();

    await writeFile(file, JSON.stringify({ version: 99, items: [] }), 'utf8');
    await expect(loadNativeChatTranscript('conv-1')).resolves.toBeNull();
  });

  it('refuses unsafe conversation ids', async () => {
    await saveNativeChatTranscript('../escape', TRANSCRIPT);
    await expect(loadNativeChatTranscript('../escape')).resolves.toBeNull();
    await expect(loadNativeChatTranscript('a/b')).resolves.toBeNull();
  });

  it('deletes transcripts and tolerates missing files', async () => {
    await saveNativeChatTranscript('conv-1', TRANSCRIPT);
    await deleteNativeChatTranscript('conv-1');
    await expect(loadNativeChatTranscript('conv-1')).resolves.toBeNull();
    await expect(deleteNativeChatTranscript('conv-1')).resolves.toBeUndefined();
  });
});
