import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { LocalAttachmentStore } from './local-attachment-store';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('recovers bytes and metadata after the writer dies immediately after publication rename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'attachment-crash-'));
  roots.push(root);
  const { id } = await crashWriter(root, 'after-rename');
  const store = new LocalAttachmentStore(root);
  const attachment = await store.get({ kind: 'conversation', id: 'crashed-owner' }, id);
  expect(attachment?.ref).toMatchObject({ id, name: 'image.png', mimeType: 'image/png' });
  if (!attachment) throw new Error('Missing committed attachment');
  const chunks: Uint8Array[] = [];
  for await (const chunk of attachment.source) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
});

it.each(['during-stream', 'before-rename'] as const)(
  'reclaims unpublished bytes after a writer crash %s',
  async (boundary) => {
    const root = await mkdtemp(join(tmpdir(), 'attachment-crash-'));
    roots.push(root);
    const { id } = await crashWriter(root, boundary);
    expect(await readdir(join(root, '.staging/conversation'))).toHaveLength(1);
    const store = new LocalAttachmentStore(root);
    await store.initialize('conversation');
    expect(await readdir(join(root, '.staging/conversation'))).toEqual([]);
    expect(await store.get({ kind: 'conversation', id: 'crashed-owner' }, id)).toBeNull();
  }
);

function crashWriter(
  root: string,
  boundary: 'during-stream' | 'before-rename' | 'after-rename'
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        '--conditions=development',
        '--import',
        'tsx',
        fileURLToPath(new URL('./test/fixtures/crash-attachment-worker.ts', import.meta.url)),
        root,
        boundary,
      ],
      { timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error?.signal !== 'SIGKILL' || !stdout) {
          reject(new Error(`Writer did not reach crash boundary: ${stderr}`, { cause: error }));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}
