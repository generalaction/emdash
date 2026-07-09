import { LiveLogClient } from '../../src/live/log/index';
import { appendLine, attach, fetchSnapshot } from './server';

async function main(): Promise<void> {
  const client = new LiveLogClient({
    refetchSnapshot: fetchSnapshot,
    onReset: (data) => console.log('log reset:', data),
    onAppend: (chunk) => console.log('log append:', JSON.stringify(chunk)),
  });

  client.seed(await fetchSnapshot());
  const detach = attach((update) => client.applyUpdate(update));

  appendLine('first line');
  appendLine('second line');
  appendLine('third line');

  console.log('written log bytes:', client.writtenOffset);
  detach();
}

void main();
