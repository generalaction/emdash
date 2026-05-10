import { EventEmitter } from 'node:events';
import type { AgentEventEnvelope } from '@shared/events/agentEvents';

/**
 * Main-process Node bus for agent events.
 *
 * The shared `events` channel is IPC main → renderer; main itself can't
 * listen to it. Modules that need to react to agent events from inside main
 * (e.g. the internal MCP loopback) subscribe here. Both the hook server and
 * the classifier publish to this bus alongside the IPC emit.
 */
class AgentEventBus extends EventEmitter {
  emitEnvelope(envelope: AgentEventEnvelope): void {
    this.emit('event', envelope);
  }

  onEvent(cb: (envelope: AgentEventEnvelope) => void): () => void {
    this.on('event', cb);
    return () => this.off('event', cb);
  }
}

export const agentEventBus = new AgentEventBus();
agentEventBus.setMaxListeners(50);
