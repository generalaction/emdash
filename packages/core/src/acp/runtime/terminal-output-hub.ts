import type { AgentTerminalHooks } from '../agent-terminal-manager';
import type { TerminalState } from '../models/terminals';
import type { TerminalOutputEvent } from '../api/streams';

type Subscriber = {
  push(event: TerminalOutputEvent): void;
  close(): void;
};

export class TerminalOutputHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  readonly hooks: AgentTerminalHooks = {
    onTerminalCreated: () => {},
    onTerminalOutput: ({ terminalId, chunk, truncated }) => {
      this.publish(terminalId, { kind: 'chunk', chunk, truncated });
    },
    onTerminalExit: ({ terminalId, exitStatus }) => {
      this.publish(terminalId, { kind: 'finished', exitStatus });
      this.close(terminalId);
    },
    onTerminalReleased: ({ terminalId }) => {
      this.close(terminalId);
    },
  };

  async *subscribe(
    terminalId: string,
    offset: number | undefined,
    snapshot: () => TerminalState | undefined
  ): AsyncGenerator<TerminalOutputEvent> {
    const initial = snapshot();
    if (!initial) return;

    const start = Math.max(0, offset ?? 0);
    const replay = initial.output.slice(start);
    if (replay.length > 0) {
      yield { kind: 'chunk', chunk: replay, truncated: initial.truncated };
    }
    if (initial.exitStatus) {
      yield { kind: 'finished', exitStatus: initial.exitStatus };
      return;
    }

    const queue: TerminalOutputEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const subscriber: Subscriber = {
      push: (event) => {
        queue.push(event);
        wake?.();
      },
      close: () => {
        closed = true;
        wake?.();
      },
    };
    this.add(terminalId, subscriber);

    try {
      while (!closed || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    } finally {
      this.remove(terminalId, subscriber);
    }
  }

  private add(terminalId: string, subscriber: Subscriber): void {
    let subscribers = this.subscribers.get(terminalId);
    if (!subscribers) {
      subscribers = new Set();
      this.subscribers.set(terminalId, subscribers);
    }
    subscribers.add(subscriber);
  }

  private remove(terminalId: string, subscriber: Subscriber): void {
    const subscribers = this.subscribers.get(terminalId);
    if (!subscribers) return;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) this.subscribers.delete(terminalId);
  }

  private publish(terminalId: string, event: TerminalOutputEvent): void {
    for (const subscriber of this.subscribers.get(terminalId) ?? []) {
      subscriber.push(event);
    }
  }

  private close(terminalId: string): void {
    for (const subscriber of this.subscribers.get(terminalId) ?? []) {
      subscriber.close();
    }
    this.subscribers.delete(terminalId);
  }
}
