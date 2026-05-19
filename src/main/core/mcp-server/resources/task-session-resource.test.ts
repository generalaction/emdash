/**
 * Tests for the `emdash://tasks/{taskId}/sessions/{sessionId}` resource.
 *
 * Drives a real `McpServer` instance and exercises:
 *   - read: returns `{ data, cursor, eof }` JSON via the templated URI.
 *   - subscribe: invoking the underlying SubscribeRequest handler registers
 *     a listener on the adapter that, when fired, sends a
 *     `notifications/resources/updated` notification.
 *   - unsubscribe / shared subscribe handler for non-PTY URIs is a no-op.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type { PtyMcpAdapter, PtySnapshotListener } from './pty-mcp-adapter';
import { _resetSubscriptionsFor, registerTaskSessionResource } from './task-session-resource';

type ServerInternals = {
  _registeredResourceTemplates: Record<
    string,
    {
      resourceTemplate: { uriTemplate: { toString(): string } };
      readCallback: (
        uri: URL,
        variables: Record<string, string>,
        extra: unknown
      ) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>;
    }
  >;
};

function makeServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

function makeAdapter(overrides: Partial<PtyMcpAdapter> = {}): PtyMcpAdapter {
  const base: PtyMcpAdapter = {
    snapshot: vi.fn().mockReturnValue({ data: '', cursor: 0, eof: false }),
    subscribeForResource: vi.fn().mockReturnValue(() => undefined),
  } as unknown as PtyMcpAdapter;
  return Object.assign(base, overrides);
}

describe('task-session-resource', () => {
  it('registers a templated resource at emdash://tasks/{taskId}/sessions/{sessionId}', () => {
    const server = makeServer();
    const adapter = makeAdapter();
    registerTaskSessionResource(server, adapter);

    const internals = server as unknown as ServerInternals;
    const entry = internals._registeredResourceTemplates['task-session'];
    expect(entry).toBeDefined();
    expect(entry!.resourceTemplate.uriTemplate.toString()).toBe(
      'emdash://tasks/{taskId}/sessions/{sessionId}'
    );
    _resetSubscriptionsFor(server);
  });

  it('read returns JSON snapshot { data, cursor, eof } with application/json mime', async () => {
    const server = makeServer();
    const adapter = makeAdapter({
      snapshot: vi.fn().mockReturnValue({ data: 'hello', cursor: 5, eof: false }),
    } as Partial<PtyMcpAdapter>);
    registerTaskSessionResource(server, adapter);

    const internals = server as unknown as ServerInternals;
    const entry = internals._registeredResourceTemplates['task-session']!;
    const uri = new URL('emdash://tasks/t-1/sessions/s-1');
    const result = await entry.readCallback(uri, { taskId: 't-1', sessionId: 's-1' }, {});

    expect(adapter.snapshot).toHaveBeenCalledWith('s-1');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]!.uri).toBe('emdash://tasks/t-1/sessions/s-1');
    expect(result.contents[0]!.mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0]!.text)).toEqual({
      data: 'hello',
      cursor: 5,
      eof: false,
    });
    _resetSubscriptionsFor(server);
  });

  it('subscribe wires a listener that fires resource-updated notifications on deltas', async () => {
    const server = makeServer();
    let installed: PtySnapshotListener | undefined;
    const unsubscribe = vi.fn();
    const adapter = makeAdapter({
      subscribeForResource: vi.fn((_sid: string, cb: PtySnapshotListener) => {
        installed = cb;
        return unsubscribe;
      }),
    } as Partial<PtyMcpAdapter>);
    registerTaskSessionResource(server, adapter);

    // The McpServer's underlying Server holds the request handlers. We poke
    // the registered handlers directly via the protocol internals — the
    // alternative (a paired in-memory transport) would be overkill here.
    type Protocol = {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
    };
    const protocol = server.server as unknown as Protocol;
    const subscribeHandler = protocol._requestHandlers.get('resources/subscribe');
    expect(subscribeHandler).toBeDefined();

    // Spy on the notification path.
    const sendSpy = vi.spyOn(server.server, 'sendResourceUpdated').mockResolvedValue(undefined);

    const uri = 'emdash://tasks/t-1/sessions/s-1';
    await subscribeHandler!(
      { method: 'resources/subscribe', params: { uri } },
      { sendNotification: vi.fn() }
    );
    expect(adapter.subscribeForResource).toHaveBeenCalledWith('s-1', expect.any(Function));

    // Simulate a PTY delta — should trigger sendResourceUpdated for the URI.
    installed!({ data: 'chunk', cursor: 0, eof: false });
    expect(sendSpy).toHaveBeenCalledWith({ uri });

    // Unsubscribe cleans up the registry listener.
    const unsubscribeHandler = protocol._requestHandlers.get('resources/unsubscribe');
    expect(unsubscribeHandler).toBeDefined();
    await unsubscribeHandler!(
      { method: 'resources/unsubscribe', params: { uri } },
      { sendNotification: vi.fn() }
    );
    expect(unsubscribe).toHaveBeenCalled();

    _resetSubscriptionsFor(server);
  });

  it('subscribe to a non-PTY URI is accepted but installs no listener (v1 placeholder)', async () => {
    const server = makeServer();
    const adapter = makeAdapter();
    registerTaskSessionResource(server, adapter);

    type Protocol = {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
    };
    const protocol = server.server as unknown as Protocol;
    const subscribeHandler = protocol._requestHandlers.get('resources/subscribe')!;

    await subscribeHandler(
      { method: 'resources/subscribe', params: { uri: 'emdash://projects' } },
      { sendNotification: vi.fn() }
    );
    expect(adapter.subscribeForResource).not.toHaveBeenCalled();
    _resetSubscriptionsFor(server);
  });
});
