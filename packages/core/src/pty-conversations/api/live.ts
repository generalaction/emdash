import type { LiveLogSnapshotData, LiveSource } from '../../live';
import { defineLiveTopic, type LiveResolver, WireError } from '../../wire';
import type { PtySessionList } from './schemas';
import type { PtyConversationsRuntime } from '../runtime/runtime';

type ConversationInput = { conversationId: string };

export const ptyAgentLiveTopics = {
  sessions: defineLiveTopic<void | undefined, PtySessionList>('ptyAgent.sessions'),
  output: defineLiveTopic<ConversationInput, LiveLogSnapshotData>('ptyAgent.output', {
    serialize: ({ conversationId }) => conversationId,
  }),
};

export type PtyAgentLiveTopics = typeof ptyAgentLiveTopics;

export function createPtyAgentLiveResolver(runtime: PtyConversationsRuntime): LiveResolver {
  return (topic) => {
    const { name, key } = splitTopic(topic);
    switch (name) {
      case 'ptyAgent.sessions':
        return runtime.sessionsLiveModel();
      case 'ptyAgent.output':
        return key
          ? (runtime.outputLog(key) ?? missingLiveSource(`Unknown conversation '${key}'`))
          : missingLiveSource('Missing conversation id');
      default:
        return null;
    }
  };
}

function missingLiveSource(message: string): LiveSource {
  return {
    snapshot() {
      throw new WireError('NOT_FOUND', message);
    },
    subscribe() {
      return () => {};
    },
  };
}

function splitTopic(topic: string): { name: string; key: string } {
  const index = topic.indexOf(':');
  if (index === -1) return { name: topic, key: '' };
  return {
    name: topic.slice(0, index),
    key: topic.slice(index + 1),
  };
}
