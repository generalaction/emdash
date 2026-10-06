/**
 * End-to-end wire smoke test: connects to the running emdash-web server over
 * WebSocket, speaks the framed stream protocol, and invokes real domain
 * procedures through the desktop controller bundle.
 *
 * Usage: node scripts/smoke.mjs ws://127.0.0.1:4200/ws?token=...
 */
import { connect, streamTransport } from '@emdash/wire/rpc';
import WebSocket from 'ws';

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/smoke.mjs ws://host:port/ws?token=...');
  process.exit(1);
}

const ws = new WebSocket(url);
ws.binaryType = 'nodebuffer';

const dataListeners = new Set();
const closeListeners = new Set();
ws.on('message', (chunk) => {
  for (const listener of dataListeners) listener(chunk);
});
ws.on('close', () => {
  for (const listener of closeListeners) listener();
});

const input = {
  on(event, cb) {
    if (event === 'data') dataListeners.add(cb);
    else closeListeners.add(cb);
    return this;
  },
};
const output = { write: (chunk) => ws.send(chunk) };

const opened = new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
  setTimeout(() => reject(new Error('connect timeout')), 10_000);
});

await opened;
console.log('✓ WebSocket connected');
const connection = connect(streamTransport(input, output));

const calls = [
  ['projects.getHostHomeDir', { type: 'local' }],
  ['projects.getDefaultRepositoriesRoot', { type: 'local' }],
];

for (const [path, input] of calls) {
  try {
    const result = await connection.call(path, input, { timeoutMs: 15_000 });
    console.log(`✓ ${path} →`, JSON.stringify(result));
  } catch (error) {
    console.log(`✗ ${path} →`, error instanceof Error ? error.message : error);
  }
}

// Live model attach: the projects list live state (sidebar's data source).
try {
  const snapshot = await connection.snapshot('projects.projectList.list');
  console.log(
    '✓ live snapshot projects.projectList.list →',
    JSON.stringify(snapshot).slice(0, 200)
  );
} catch (error) {
  console.log('ℹ live snapshot:', error instanceof Error ? error.message : error);
}

// Full write path: create a local project (wire → controller → SQLite → live update).
const projectPath = process.argv[3] ?? '/home/panjinhui/code/SkillBridge';
try {
  const created = await connection.call(
    'projects.createProject',
    { type: 'local', path: projectPath, name: 'SkillBridge' },
    { timeoutMs: 60_000 }
  );
  console.log('✓ projects.createProject →', JSON.stringify(created).slice(0, 300));
  const after = await connection.snapshot('projects.projectList.list');
  const data = JSON.stringify(after);
  console.log(
    data.includes('SkillBridge')
      ? '✓ project appears in live project list'
      : `ℹ project list after create: ${data.slice(0, 300)}`
  );
} catch (error) {
  console.log('ℹ createProject:', error instanceof Error ? error.message : error);
}

ws.close();
process.exit(0);
