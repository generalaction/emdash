import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron, type ElectronApplication, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;

type Lease = {
  verificationRunId: string;
  browserId: string;
  projectId: string;
  taskId: string;
  workspaceId: string;
  partition: string;
  allowedPreviewOrigin: string;
};

type VerificationSession = { lease: Lease; previewServerId: string; previewUrl: string };
type StartResult =
  | { success: true; data: VerificationSession }
  | { success: false; error: { kind: string; message: string } };

const fixtureHtml = `<!doctype html>
<html><body><main><h1>Loops Electron fixture</h1><button data-testid="increment" aria-label="Increment">Increment</button><output aria-label="Count">0</output></main><script>const button=document.querySelector('button');const output=document.querySelector('output');button.addEventListener('click',()=>{output.textContent=String(Number(output.textContent)+1)});</script></body></html>`;

const root = mkdtempSync(join(tmpdir(), 'emdash-loops-electron-'));
const userData = join(root, 'user-data');
const dbFile = join(root, 'emdash.db');
const keyPath = join(root, 'id_ed25519');
const composeProject = `emdash-loops-electron-${process.pid}`;
const composeFile = join(process.cwd(), 'tooling/loops-electron/docker-compose.yaml');
const containerSshFallback =
  process.env.EMDASH_LOOPS_ELECTRON_CONTAINER_SSH === '1' ||
  (existsSync('/.dockerenv') && process.env.EMDASH_LOOPS_ELECTRON_CONTAINER_SSH !== '0');
const authorizedKeysPath = join(process.env.HOME ?? '', '.ssh/authorized_keys');
let electronApp: ElectronApplication | undefined;
let localServer: Server | undefined;
let remoteFallbackServer: Server | undefined;
let localPortBlocker: ReturnType<typeof createTcpServer> | undefined;
let rotationPortBlocker: ReturnType<typeof createTcpServer> | undefined;
let dockerStarted = false;
let authorizedKeysBackup:
  | { existed: false }
  | { existed: true; contents: Buffer; mode: number }
  | undefined;

try {
  localServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fixtureHtml);
  });
  const localPort = await listen(localServer, 0);

  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: ['.', '--no-sandbox', '--disable-gpu', '--password-store=basic'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      EMDASH_DB_FILE: dbFile,
      EMDASH_LOOPS_ELECTRON_TEST: '1',
      EMDASH_LOOPS_ELECTRON_USER_DATA: userData,
      EMDASH_DISABLE_PTY: '1',
      TELEMETRY_ENABLED: 'false',
    },
  });
  const page = await electronApp.firstWindow();
  page.on('console', (message) =>
    process.stderr.write(`[renderer:${message.type()}] ${message.text()}\n`)
  );
  page.on('pageerror', (error) => process.stderr.write(`[renderer:error] ${error.message}\n`));
  await page.waitForFunction(() => window.electronAPI !== undefined);
  assert.deepEqual(await invoke(page, 'loopsElectronTest.ping'), { mode: 'loops-electron' });
  await page.waitForFunction(() => document.querySelector('#root')?.childElementCount !== 0);
  await delay(250);

  await proveLocalElectronFlow(page, localPort);
  await proveCancelledDiscovery(page);

  if (process.env.EMDASH_LOOPS_ELECTRON_LOCAL_ONLY !== '1') {
    const sshPort = containerSshFallback ? 22 : await startDockerSshFixture();
    await waitForTcp(sshPort);
    await proveSshFlow(page, sshPort);
  }

  process.stdout.write('Loops Electron harness passed: local native host');
  process.stdout.write(
    process.env.EMDASH_LOOPS_ELECTRON_LOCAL_ONLY === '1'
      ? ' (Docker SSH explicitly skipped)\n'
      : containerSshFallback
        ? ' and current-container SSH forwarding/rotation\n'
        : ' and Docker SSH forwarding/rotation\n'
  );
} finally {
  localPortBlocker?.close();
  rotationPortBlocker?.close();
  remoteFallbackServer?.close();
  localServer?.close();
  await electronApp?.close().catch(() => undefined);
  if (dockerStarted) {
    docker([
      'compose',
      '-p',
      composeProject,
      '-f',
      composeFile,
      'down',
      '--volumes',
      '--remove-orphans',
    ]);
  }
  restoreAuthorizedKeys();
  rmSync(root, { recursive: true, force: true });
}

async function proveLocalElectronFlow(page: Page, port: number): Promise<void> {
  const projectId = 'electron-local-project';
  const workspaceId = 'electron-local-workspace';
  const preview = await invoke<{ id: string }>(page, 'loopsElectronTest.registerLocalPreview', {
    projectId,
    workspaceId,
    port,
  });
  const start = await invoke<StartResult>(page, 'loopsElectronTest.start', {
    verificationRunId: 'electron-local-run',
    projectId,
    taskId: 'electron-local-task',
    workspaceId,
    previewServerId: preview.id,
  });
  if (!start.success) {
    const trace = await invoke(page, 'loopsElectronTest.getTrace');
    const webviews = await page.locator('webview').count();
    process.stderr.write(
      `Local start failed with ${webviews} webview(s): ${JSON.stringify(trace)}\n`
    );
  }
  assert.equal(start.success, true, failureMessage(start));
  if (!start.success) return;

  const query = await invoke<{ result: { ok: boolean } }>(page, 'loopsElectronTest.performAction', {
    lease: start.data.lease,
    actionId: 'local-query',
    action: {
      kind: 'accessibility-query',
      target: { testId: 'increment' },
      limit: 1,
    },
  });
  assert.equal(query.result.ok, true, 'scoped accessibility query failed');
  const click = await invoke<{ result: { ok: boolean } }>(page, 'loopsElectronTest.performAction', {
    lease: start.data.lease,
    actionId: 'local-click',
    action: { kind: 'click', target: { testId: 'increment' } },
  });
  assert.equal(click.result.ok, true, 'scoped click failed');

  const closed = await invoke<{ partitionDataCleared: boolean; reason: string }>(
    page,
    'loopsElectronTest.close',
    { lease: start.data.lease, reason: 'cancelled' }
  );
  assert.equal(closed.reason, 'cancelled');
  assert.equal(closed.partitionDataCleared, true, 'disposable partition was not cleared');
  await expectTrace(page, start.data.lease.verificationRunId, [
    'host-request',
    'session-registered',
    'partition-configured',
    'renderer-ready',
    'ready-attested',
    'action-requested',
    'action-executed',
    'close-requested',
    'renderer-closed',
    'session-cleaned',
  ]);
  await invoke(page, 'previewServers.stop', preview.id);
}

async function proveCancelledDiscovery(page: Page): Promise<void> {
  const verificationRunId = 'electron-cancelled-discovery';
  assert.equal(
    await invoke(page, 'loopsElectronTest.beginStart', {
      verificationRunId,
      projectId: 'missing-preview-project',
      taskId: 'missing-preview-task',
      workspaceId: 'missing-preview-workspace',
    }),
    true
  );
  assert.equal(await invoke(page, 'loopsElectronTest.cancelStart', verificationRunId), true);
  const result = await poll<StartResult | null>(async () =>
    invoke(page, 'loopsElectronTest.getStartResult', verificationRunId)
  );
  assert.equal(result?.success, false);
  if (result?.success === false) assert.equal(result.error.kind, 'cancelled');
}

async function proveSshFlow(page: Page, sshPort: number): Promise<void> {
  generateSshKey();
  const containerId = containerSshFallback ? undefined : dockerContainerId();
  if (containerSshFallback) installFallbackAuthorizedKey();
  else installDockerAuthorizedKey(containerId!);

  const remoteFixture = join(root, 'remote-index.html');
  writeFileSync(remoteFixture, fixtureHtml);
  if (containerId) {
    docker(['exec', containerId, 'mkdir', '-p', '/tmp/loops-preview']);
    docker(['cp', remoteFixture, `${containerId}:/tmp/loops-preview/index.html`]);
  }
  const remotePort = await getFreePort();
  const blockedPreferredPort = await getFreePort();
  await startRemoteServer(containerId, remotePort);

  localPortBlocker = createTcpServer();
  await listenTcp(localPortBlocker, blockedPreferredPort);

  const connection = await invoke<{ id: string }>(page, 'ssh.saveConnection', {
    name: `Loops Electron ${process.pid}`,
    host: '127.0.0.1',
    port: sshPort,
    username: 'devuser',
    authType: 'key',
    privateKeyPath: keyPath,
    useAgent: false,
  });
  assert.equal(await invoke(page, 'ssh.connect', connection.id), 'connected');

  const projectId = 'electron-ssh-project';
  const workspaceId = 'electron-ssh-workspace';
  const forwarded = await invoke<
    | { success: true; data: { id: string; localPort: number } }
    | { success: false; error: { message: string } }
  >(page, 'previewServers.forwardManual', {
    projectId,
    workspaceId,
    connectionId: connection.id,
    protocol: 'http:',
    remotePort,
    preferredLocalPort: blockedPreferredPort,
  });
  assert.equal(forwarded.success, true, forwarded.success ? undefined : forwarded.error.message);
  if (!forwarded.success) return;
  assert.notEqual(
    forwarded.data.localPort,
    blockedPreferredPort,
    'local collision did not force fallback'
  );
  const forwardedHtml = await fetch(`http://127.0.0.1:${forwarded.data.localPort}/`).then(
    (response) => response.text()
  );
  assert.match(forwardedHtml, /Loops Electron fixture/, 'SSH forward did not reach the preview');

  const start = await invoke<StartResult>(page, 'loopsElectronTest.start', {
    verificationRunId: 'electron-ssh-run',
    projectId,
    taskId: 'electron-ssh-task',
    workspaceId,
    previewServerId: forwarded.data.id,
  });
  assert.equal(start.success, true, failureMessage(start));
  if (!start.success) return;

  const navigation = await invoke<{ result: { ok: boolean } }>(
    page,
    'loopsElectronTest.performAction',
    {
      lease: start.data.lease,
      actionId: 'ssh-navigate',
      action: { kind: 'navigate', url: start.data.previewUrl },
    }
  );
  assert.equal(
    navigation.result.ok,
    true,
    `forwarded preview navigation failed: ${JSON.stringify(navigation.result)}`
  );

  assert.equal(await invoke(page, 'loopsElectronTest.pauseForReconnect', start.data.lease), true);

  await stopRemoteServer(containerId);
  await triggerPortForwardFailure(forwarded.data.localPort);
  await poll(async () => {
    const previews = await invoke<Array<{ id: string; status: { kind: string } }>>(
      page,
      'previewServers.listForWorkspace',
      { projectId, workspaceId }
    );
    return previews.find((preview) => preview.id === forwarded.data.id)?.status.kind === 'failed'
      ? true
      : null;
  }, 20_000);
  if (containerId) {
    rotationPortBlocker = createTcpServer();
    await listenTcp(rotationPortBlocker, remotePort);
  }
  await startRemoteServer(containerId, remotePort);
  const restarted = await invoke<{ id: string; localPort?: number; status: { kind: string } }>(
    page,
    'previewServers.restart',
    forwarded.data.id
  );
  assert.equal(restarted.status.kind, 'ready');
  assert.ok(restarted.localPort);
  assert.notEqual(restarted.localPort, forwarded.data.localPort, 'SSH origin did not rotate');

  const reconciled = await invoke<
    | { success: true; data: { kind: string; session: VerificationSession } }
    | { success: false; error: { message: string } }
  >(page, 'loopsElectronTest.reconcilePreview', start.data.lease);
  assert.equal(reconciled.success, true, reconciled.success ? undefined : reconciled.error.message);
  if (!reconciled.success) return;
  assert.equal(reconciled.data.kind, 'rotated');
  assert.notEqual(reconciled.data.session.lease.browserId, start.data.lease.browserId);
  assert.notEqual(
    reconciled.data.session.lease.allowedPreviewOrigin,
    start.data.lease.allowedPreviewOrigin
  );
  const closed = await invoke<{ partitionDataCleared: boolean }>(page, 'loopsElectronTest.close', {
    lease: reconciled.data.session.lease,
    reason: 'completed',
  });
  assert.equal(closed.partitionDataCleared, true);
  await invoke(page, 'previewServers.stop', forwarded.data.id);
  await invoke(page, 'ssh.disconnect', connection.id);
  await invoke(page, 'ssh.deleteConnection', connection.id);
}

async function invoke<T = unknown>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return (await page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), {
    channel,
    args,
  })) as T;
}

async function expectTrace(page: Page, runId: string, expected: string[]): Promise<void> {
  const entries = await invoke<Array<{ kind: string; verificationRunId?: string }>>(
    page,
    'loopsElectronTest.getTrace'
  );
  const kinds = entries
    .filter((entry) => entry.verificationRunId === runId || entry.kind === 'partition-configured')
    .map((entry) => entry.kind);
  for (const kind of expected) assert.ok(kinds.includes(kind), `missing Electron trace: ${kind}`);
}

async function poll<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await delay(50);
  }
  throw new Error('Timed out waiting for Electron harness state');
}

function failureMessage(result: StartResult): string | undefined {
  return result.success ? undefined : `${result.error.kind}: ${result.error.message}`;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No HTTP port'));
      resolve(address.port);
    });
  });
}

function listenTcp(server: ReturnType<typeof createTcpServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitForTcp(port: number): Promise<void> {
  await poll(async () => {
    const socket = await new Promise<boolean>((resolve) => {
      const probe = new Socket();
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', () => resolve(false));
      probe.connect(port, '127.0.0.1');
    });
    return socket ? true : null;
  }, 30_000);
}

async function triggerPortForwardFailure(port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = new Socket();
    socket.once('connect', () => {
      socket.end(
        'GET /loops-forward-failure HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      );
    });
    socket.once('close', () => resolve());
    socket.once('error', () => resolve());
    socket.connect(port, '127.0.0.1');
  });
}

function requireCommand(command: string): void {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required for the mandatory Docker SSH Electron proof`);
  }
}

async function startDockerSshFixture(): Promise<number> {
  requireCommand('docker');
  docker(['compose', '-p', composeProject, '-f', composeFile, 'up', '--build', '-d']);
  dockerStarted = true;
  const published = docker([
    'compose',
    '-p',
    composeProject,
    '-f',
    composeFile,
    'port',
    'loops-ssh',
    '22',
  ]).trim();
  const sshPort = Number(published.slice(published.lastIndexOf(':') + 1));
  assert.ok(Number.isInteger(sshPort) && sshPort > 0, `Invalid Docker SSH port: ${published}`);
  return sshPort;
}

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

async function getFreePort(): Promise<number> {
  const server = createTcpServer();
  await listenTcp(server, 0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'Could not reserve an SSH fixture port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

function generateSshKey(): void {
  const result = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath]);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'ssh-keygen failed');
}

function dockerContainerId(): string {
  const containerId = docker([
    'compose',
    '-p',
    composeProject,
    '-f',
    composeFile,
    'ps',
    '-q',
    'loops-ssh',
  ]).trim();
  assert.ok(containerId, 'Docker SSH container ID was empty');
  return containerId;
}

function installDockerAuthorizedKey(containerId: string): void {
  docker(['cp', `${keyPath}.pub`, `${containerId}:/tmp/loops-electron.pub`]);
  docker([
    'exec',
    containerId,
    'bash',
    '-lc',
    'install -d -m 700 -o devuser -g devuser /home/devuser/.ssh && install -m 600 -o devuser -g devuser /tmp/loops-electron.pub /home/devuser/.ssh/authorized_keys',
  ]);
}

function installFallbackAuthorizedKey(): void {
  assert.ok(existsSync('/.dockerenv'), 'container SSH fallback is allowed only inside Docker');
  mkdirSync(join(process.env.HOME ?? '', '.ssh'), { recursive: true, mode: 0o700 });
  authorizedKeysBackup = existsSync(authorizedKeysPath)
    ? {
        existed: true,
        contents: readFileSync(authorizedKeysPath),
        mode: statSync(authorizedKeysPath).mode,
      }
    : { existed: false };
  const previous = authorizedKeysBackup.existed ? authorizedKeysBackup.contents.toString() : '';
  const publicKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
  writeFileSync(authorizedKeysPath, `${previous.trimEnd()}${previous ? '\n' : ''}${publicKey}\n`);
  chmodSync(authorizedKeysPath, 0o600);
}

function restoreAuthorizedKeys(): void {
  if (!authorizedKeysBackup) return;
  if (!authorizedKeysBackup.existed) {
    if (existsSync(authorizedKeysPath)) unlinkSync(authorizedKeysPath);
    return;
  }
  writeFileSync(authorizedKeysPath, authorizedKeysBackup.contents);
  chmodSync(authorizedKeysPath, authorizedKeysBackup.mode & 0o777);
}

async function startRemoteServer(containerId: string | undefined, port: number): Promise<void> {
  if (!containerId) {
    remoteFallbackServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixtureHtml);
    });
    await listen(remoteFallbackServer, port);
    return;
  }
  docker([
    'exec',
    containerId,
    'bash',
    '-lc',
    `cd /tmp/loops-preview && nohup python3 -m http.server ${port} --bind 127.0.0.1 >/tmp/loops-preview.log 2>&1 & echo $! >/tmp/loops-preview.pid`,
  ]);
}

async function stopRemoteServer(containerId: string | undefined): Promise<void> {
  if (!containerId) {
    const server = remoteFallbackServer;
    remoteFallbackServer = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    return;
  }
  docker([
    'exec',
    containerId,
    'bash',
    '-lc',
    'test ! -f /tmp/loops-preview.pid || kill "$(cat /tmp/loops-preview.pid)" 2>/dev/null || true',
  ]);
}
