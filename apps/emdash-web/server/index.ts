/**
 * Emdash Web server entry.
 *
 * Boots the exact desktop backend stack — SQLite database, SSH
 * infrastructure, runtime workers, services, and the full wire controller
 * bundle — then exposes it over WebSocket (`/ws?token=...`) and serves the
 * web renderer build as static files.
 *
 * Environment:
 *   EMDASH_WEB_PORT      listen port (default 4200)
 *   EMDASH_WEB_HOST      bind address (default 127.0.0.1)
 *   EMDASH_WEB_TOKEN     access token; auto-generated and printed when unset
 *   EMDASH_WEB_DATA_DIR  user-data directory (default ~/.emdash-web)
 *   EMDASH_WEB_APP_DIR   app root hosting out/main worker bundles
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { conversationWireEvents } from '@core/features/conversations/node/event-host';
import { loadActiveAgentStatusConversationIds } from '@core/features/conversations/node/load-active-agent-status-conversation-ids';
import { renameConversation } from '@core/features/conversations/node/renameConversation';
import { bootBackground } from '@main/bootstrap/boot/phases/background';
import { bootControllers } from '@main/bootstrap/boot/phases/controllers';
import { bootDatabase } from '@main/bootstrap/boot/phases/database';
import { bootInfrastructure } from '@main/bootstrap/boot/phases/infrastructure';
import { bootRuntimes } from '@main/bootstrap/boot/phases/runtimes';
import { bootServices } from '@main/bootstrap/boot/phases/services';
import { loadAppConfig, setAppConfig } from '@main/bootstrap/core/config';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { setAgentStatusConversationEventPublisher } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import { startUserEnvCapture } from '@main/lib/userEnv';
import { createStaticHandler } from './static';
import { attachWireGateway } from './ws-gateway';

const here = resolve(fileURLToPath(import.meta.url), '..');

const PORT = Number(process.env.EMDASH_WEB_PORT ?? 4200);
const HOST = process.env.EMDASH_WEB_HOST ?? '127.0.0.1';
const TOKEN = process.env.EMDASH_WEB_TOKEN ?? randomBytes(24).toString('base64url');
const DATA_DIR = resolve(process.env.EMDASH_WEB_DATA_DIR ?? join(homedir(), '.emdash-web'));

async function main(): Promise<void> {
  // The token rides plaintext HTTP/WebSocket query strings; refuse non-loopback
  // binds unless the operator explicitly acknowledges the exposure and fronts
  // the server with a TLS-terminating proxy.
  const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  const allowInsecureRemote = process.env.EMDASH_WEB_ALLOW_INSECURE_REMOTE === '1';
  if (!isLoopback && !allowInsecureRemote) {
    console.error(
      `[emdash-web] refusing to bind ${HOST}: the access token travels over plaintext ` +
        'HTTP/WebSocket. Front the server with a TLS-terminating proxy, or set ' +
        'EMDASH_WEB_ALLOW_INSECURE_REMOTE=1 to acknowledge the exposure on a trusted network.'
    );
    process.exit(1);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(join(DATA_DIR, 'logs'), { recursive: true });

  const config = loadAppConfig({
    ...process.env,
    emdashUserDataDir: DATA_DIR,
  } as NodeJS.ProcessEnv);
  setAppConfig(config);

  startUserEnvCapture();
  const database = await bootDatabase(config);
  const infrastructure = await bootInfrastructure(database);
  const runtimes = await bootRuntimes(database, infrastructure);
  const services = await bootServices(database, infrastructure, runtimes);
  const controllers = await bootControllers(database, infrastructure, runtimes, services);

  // Conversation/agent status bridges keep the UI live-updating.
  const publishConversationEvent = (event: Parameters<typeof conversationWireEvents.emit>[1]) =>
    conversationWireEvents.emit(undefined, event);
  setAgentStatusConversationEventPublisher(publishConversationEvent);

  acpAgentStatusBridge.initialize(
    (handler) => conversationEvents.on('conversation:created', handler),
    {
      runtimes: runtimes.broker,
      onLocalWorkerStateChanged: runtimes.workers.acp.onStateChanged.bind(runtimes.workers.acp),
      loadActiveConversationIds: (host) =>
        loadActiveAgentStatusConversationIds(database.db, host, 'acp'),
      renameConversation: (conversationId, name) =>
        renameConversation(
          {
            db: database.db,
            runtimes: runtimes.broker,
            hostIsReachable: services.hostIsReachable,
          },
          conversationId,
          name
        ),
    }
  );
  tuiAgentStatusBridge.initialize({
    runtimes: runtimes.broker,
    onLocalWorkerStateChanged: runtimes.workers.tuiAgents.onStateChanged.bind(
      runtimes.workers.tuiAgents
    ),
    loadActiveConversationIds: (host) =>
      loadActiveAgentStatusConversationIds(database.db, host, 'pty'),
  });
  services.hostAttachments.register({
    label: 'acp-agent-status',
    attach: (host) => acpAgentStatusBridge.attachHost(host),
    detach: (host) => acpAgentStatusBridge.detachHost(host),
  });
  services.hostAttachments.register({
    label: 'tui-agent-status',
    attach: (host) => tuiAgentStatusBridge.attachHost(host),
    detach: (host) => tuiAgentStatusBridge.detachHost(host),
  });

  try {
    await bootBackground(services, runtimes);
  } catch (error) {
    console.warn('[emdash-web] background tasks failed to start:', error);
  }

  const staticHandler = createStaticHandler(join(here, 'web'));
  const server = createServer((req, res) => {
    if (staticHandler(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  attachWireGateway(server, { token: TOKEN, controllers: controllers.controllers });

  server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? '<machine-ip>' : HOST;
    console.log('');
    console.log('  Emdash Web is running');
    console.log(`  URL   : http://${displayHost}:${PORT}/`);
    console.log(`  Token : ${TOKEN}`);
    console.log(`  Open  : http://${displayHost}:${PORT}/?token=${TOKEN}`);
    console.log(`  Data  : ${DATA_DIR}`);
    console.log('');
    console.log('  Keep the token private — it grants full project, git, and');
    console.log('  terminal access on this machine.');
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[emdash-web] shutting down…');
    server.close();
    server.closeAllConnections?.();
    try {
      await runtimes.dispose();
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('[emdash-web] fatal boot error:', error);
  process.exit(1);
});
