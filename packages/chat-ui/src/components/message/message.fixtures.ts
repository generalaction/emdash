import type { ChatMessage } from '../../model';

export const messageFixtures: ChatMessage[] = [
  // Short user message
  {
    kind: 'message',
    id: 'msg-1',
    role: 'user',
    text: 'Hello, can you help me with a quick question?',
  },
  // Short assistant message
  {
    kind: 'message',
    id: 'msg-2',
    role: 'assistant',
    text: 'Of course! I would be happy to help. What is your question?',
  },
  // Message with code block
  {
    kind: 'message',
    id: 'msg-3',
    role: 'assistant',
    text: 'Here is a simple example:\n\n```ts\nconst x = 1;\nconsole.log(x);\n```\n\nThis prints `1`.',
  },
];
