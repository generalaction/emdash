/**
 * Inspect registered projects and tasks over the wire.
 * Usage: node scripts/status.mjs ws://host:port/ws?token=... [projectId]
 */
import { connect, streamTransport } from '@emdash/wire/rpc';
import WebSocket from 'ws';

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/status.mjs ws://host:port/ws?token=... [projectId]');
  process.exit(1);
}

const ws = new WebSocket(url);
ws.binaryType = 'nodebuffer';
const dataListeners = new Set();
const closeListeners = new Set();
ws.on('message', (chunk) => {
  for (const l of dataListeners) l(chunk);
});
ws.on('close', () => {
  for (const l of closeListeners) l();
});
const input = {
  on(event, cb) {
    if (event === 'data') dataListeners.add(cb);
    else closeListeners.add(cb);
    return this;
  },
};
const output = { write: (chunk) => ws.send(chunk) };

await new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
  setTimeout(() => reject(new Error('timeout')), 10_000);
});

const connection = connect(streamTransport(input, output));

const projects = await connection.snapshot('projects.projectList.list');
const projectList = JSON.stringify(projects);
console.log('=== Projects ===');
let items = [];
try {
  items = JSON.parse(projectList)?.data?.projects ?? [];
} catch {
  console.log(projectList.slice(0, 300));
}
for (const p of items) {
  console.log(`- ${p.name}  [${p.type}]  ${p.path}  (id: ${p.id})`);
}

console.log('\n=== Tasks ===');
try {
  const projectId = process.argv[3] ?? items[0]?.id;
  if (!projectId) throw new Error('no projects registered');
  const topic = `tasks.taskList.list|${JSON.stringify({ projectId })}`;
  const tasks = await connection.snapshot(topic);
  const parsed = JSON.parse(JSON.stringify(tasks));
  const taskItems = parsed?.data?.tasks ?? parsed?.data ?? [];
  if (Array.isArray(taskItems)) {
    for (const t of taskItems) {
      console.log(`- ${t.name ?? t.title ?? JSON.stringify(t).slice(0, 150)}`);
    }
    if (taskItems.length === 0) console.log('(no tasks)');
  } else {
    console.log(JSON.stringify(parsed).slice(0, 500));
  }
} catch (error) {
  console.log('task query:', error instanceof Error ? error.message : error);
}

ws.close();
process.exit(0);
