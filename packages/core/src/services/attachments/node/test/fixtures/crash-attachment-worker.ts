// Subprocess fixture: terminate at the actual filesystem boundary, without unwinding
// the upload's finally blocks. Kept outside the store so production has no test hooks.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { LocalAttachmentStore } from '../../local-attachment-store';

const [root, boundary] = process.argv.slice(2);
const rename = fs.rename;
async function crash(destination: string): Promise<never> {
  await new Promise<void>((resolve) => {
    process.stdout.write(JSON.stringify({ id: basename(destination, '.png') }), () => resolve());
  });
  process.kill(process.pid, 'SIGKILL');
  return new Promise(() => {});
}
fs.rename = async (source, destination) => {
  if (boundary === 'before-rename') await crash(String(destination));
  await rename(source, destination);
  await crash(String(destination));
};
syncBuiltinESMExports();

const store = new LocalAttachmentStore(root);
const staged = await store.stage(
  { kind: 'conversation', id: 'crashed-owner' },
  {
    name: 'image.png',
    mimeType: 'image/png',
    size: 3,
    stream: async function* () {
      yield new Uint8Array([1, 2, 3]);
      if (boundary === 'during-stream') await crash('unpublished');
    },
    bytes: async () => {
      throw new Error('Unexpected buffered upload');
    },
    file: async () => {
      throw new Error('Unexpected buffered upload');
    },
    cancel() {},
  }
);
try {
  await staged.publish();
} finally {
  await staged.dispose();
}
