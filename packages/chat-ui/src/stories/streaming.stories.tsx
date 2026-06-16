/**
 * Streaming stories — scripted chunk-by-chunk message delivery.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import type { TranscriptApi } from '../state/transcript';
import type { ScriptStep } from './chat-host';
import { ScriptedChat } from './chat-host';

const meta: Meta = {
  title: 'ChatUI/Streaming',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

const PROSE_CHUNKS = [
  'Here is how JWT authentication works:\n\n',
  '## Token structure\n\n',
  'A JWT has three parts: **header**, **payload**, and **signature**, ',
  'separated by dots.\n\n',
  '## Validation\n\n',
  'The server validates the signature using a secret key. ',
  'No database lookup is needed for stateless validation.\n\n',
  '## Security considerations\n\n',
  'Always use HTTPS to prevent token interception. ',
  'Short expiry times (15–60 min) reduce the attack window.',
];

function streamChunks(chunks: string[], delayMs = 120): ScriptStep[] {
  const steps: ScriptStep[] = [];
  for (const chunk of chunks) {
    steps.push({ kind: 'wait', ms: delayMs });
    steps.push({
      kind: 'call',
      fn: (api: TranscriptApi) => {
        api.dispatch({ type: 'message_chunk', role: 'assistant', id: 'stream-1', text: chunk });
      },
    });
  }
  steps.push({ kind: 'wait', ms: 500 });
  steps.push({
    kind: 'call',
    fn: (api: TranscriptApi) => api.dispatch({ type: 'turn_done' }),
  });
  return steps;
}

export const StreamingProse: Story = {
  render: () => {
    const script: ScriptStep[] = [
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.seed([{ kind: 'message', id: 'u1', role: 'user', text: 'How does JWT work?' }]);
        },
      },
      { kind: 'wait', ms: 300 },
      ...streamChunks(PROSE_CHUNKS, 150),
    ];
    return <ScriptedChat script={script} height={600} />;
  },
};

const CODE_CHUNKS = [
  'Here is an example:\n\n```typescript\n',
  'import jwt from "jsonwebtoken";\n',
  '\nfunction createToken(userId: string): string {\n',
  '  return jwt.sign(\n',
  '    { sub: userId, iat: Date.now() },\n',
  '    process.env.JWT_SECRET!,\n',
  '    { expiresIn: "1h" }\n',
  '  );\n',
  '}\n```\n\n',
  'Store the secret in your `.env` file.',
];

export const StreamingWithCode: Story = {
  render: () => {
    const script: ScriptStep[] = [
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.seed([{ kind: 'message', id: 'u1', role: 'user', text: 'Show me a JWT example' }]);
        },
      },
      { kind: 'wait', ms: 300 },
      ...streamChunks(CODE_CHUNKS, 100),
    ];
    return <ScriptedChat script={script} height={400} />;
  },
};

export const StreamingWithThinking: Story = {
  render: () => {
    const script: ScriptStep[] = [
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.seed([{ kind: 'message', id: 'u1', role: 'user', text: 'Optimize this function' }]);
          api.dispatch({ type: 'thinking_chunk', id: 'th1', text: '' });
        },
      },
      { kind: 'wait', ms: 500 },
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.dispatch({
            type: 'thinking_chunk',
            id: 'th1',
            text: 'Looking at the function...\nIt has O(n²) complexity due to nested loops. \nAnother row of text to test the streaming functionality \nAnother row of text to test the streaming functionality \nAnother row of text to test the streaming functionality',
          });
        },
      },
      { kind: 'wait', ms: 1200 },
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.dispatch({ type: 'thinking_done', id: 'th1', durationMs: 1700 });
        },
      },
      { kind: 'wait', ms: 200 },
      ...streamChunks(
        ['The bottleneck is the nested loop. ', 'Use a `Map` to reduce to **O(n)**.'],
        200
      ),
    ];
    return <ScriptedChat script={script} height={320} />;
  },
};
