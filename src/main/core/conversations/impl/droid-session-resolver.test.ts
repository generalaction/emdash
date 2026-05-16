import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/db/client', () => ({ db: {} }));

const { findDroidSessionIdForTest } = await import('./droid-session-resolver');

const cwd = '/repo/project';
const sessionDir = '/home/user/.factory/sessions/-repo-project';

function sessionStartLine({ id, title = 'New Session' }: { id: string; title?: string }) {
  return JSON.stringify({
    type: 'session_start',
    id,
    title,
    sessionTitle: title,
    cwd,
  });
}

describe('findDroidSessionIdForTest', () => {
  it('ignores existing sessions even when their mtime updates after start', async () => {
    const oldId = '11111111-1111-4111-8111-111111111111';
    const newId = '22222222-2222-4222-8222-222222222222';

    const result = await findDroidSessionIdForTest({
      cwd,
      startedAt: 1_000,
      existingSessionIds: [oldId],
      store: {
        async home() {
          return '/home/user';
        },
        joinPath(...parts) {
          return parts.join('/');
        },
        async realpath(filePath) {
          return filePath;
        },
        async listSessionFiles(dir) {
          expect(dir).toBe(sessionDir);
          return [
            { filePath: `${sessionDir}/${oldId}.jsonl`, mtimeMs: 2_000 },
            { filePath: `${sessionDir}/${newId}.jsonl`, mtimeMs: 1_500 },
          ];
        },
        async readFirstLine(filePath) {
          if (filePath.endsWith(`${oldId}.jsonl`))
            return sessionStartLine({ id: oldId, title: '1' });
          if (filePath.endsWith(`${newId}.jsonl`))
            return sessionStartLine({ id: newId, title: '3' });
          return null;
        },
      },
    });

    expect(result).toBe(newId);
  });
});
