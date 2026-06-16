/**
 * Thinking row stories — all four states plus the active→done transition.
 *
 * Collapse semantics are inverted for thinking rows:
 *   default (no click) → not expanded: active shows preview, done shows header only
 *   after one click    → expanded:     both states show full prose body
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import type { TranscriptApi } from '../state/transcript';
import type { ScriptStep } from './chat-host';
import { ChatHost, ScriptedChat } from './chat-host';
import { scenario, seedStep, streamMessage, streamThinking } from './streaming/scenario';

const meta: Meta = {
  title: 'ChatUI/Thinking',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

// Default view: preview window visible, no user interaction needed.
export const ThinkingActive: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'thinking',
          id: 'th1',
          status: 'thinking',
          text: 'Let me analyze the codebase structure first to understand the authentication flow...\n\nLooking at the middleware chain, I can see that session tokens are validated in three different places which creates redundancy.',
          startedAt: Date.now() - 12000,
        },
      ]}
      height={160}
    />
  ),
};

/**
 * Active preview renders real prose: bold, inline code, soft breaks, and
 * paragraph gaps. Visually verifies the preview uses the same BlockStack
 * pipeline as the expanded body (no raw-text fallback).
 */
export const ThinkingActiveProsePreview: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'thinking',
          id: 'th-preview',
          status: 'thinking',
          text: [
            'Checking the **authentication** flow.',
            'Session tokens are validated in `middleware/session.ts`.',
            '',
            'Found a redundancy: the same `validateToken()` call appears in three places.',
            'Consolidating into a single middleware will fix this.',
          ].join('\n'),
          startedAt: Date.now() - 5000,
        },
      ]}
      height={200}
    />
  ),
};

// Active state expanded: click to reveal full prose body while still streaming.
export const ThinkingActiveExpanded: Story = {
  render: () => {
    const script: ScriptStep[] = [
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.seed([
            {
              kind: 'thinking',
              id: 'th1',
              status: 'thinking',
              text: 'Let me analyze the codebase structure first to understand the authentication flow...\n\nLooking at the middleware chain, I can see that session tokens are validated in three different places which creates redundancy.\n\nI will suggest consolidating validation into a single auth middleware.',
              startedAt: Date.now() - 8000,
            },
          ]);
        },
      },
      { kind: 'wait', ms: 100 },
      {
        kind: 'call',
        fn: () => {
          const btn = document.querySelector('[data-collapse-id="th1"]') as HTMLElement;
          btn?.click();
        },
      },
    ];
    return <ScriptedChat script={script} height={280} />;
  },
};

// Default view for done: header only, no content rendered.
export const ThinkingDoneCollapsed: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'thinking',
          id: 'th1',
          status: 'done',
          text: 'I have analyzed the issue. The root cause is X.',
          startedAt: Date.now() - 30000,
          durationMs: 28000,
        },
      ]}
      height={80}
    />
  ),
};

// Done expanded: click to reveal full prose body.
export const ThinkingDoneExpanded: Story = {
  render: () => {
    const script: ScriptStep[] = [
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.seed([
            {
              kind: 'thinking',
              id: 'th1',
              status: 'done',
              text: 'First I looked at the authentication flow.\n\nThe session store is created in middleware/session.ts and uses Redis as a backend. The JWT approach would eliminate the need for this entirely.\n\nI considered three approaches:\n1. Pure JWT stateless\n2. JWT + Redis blacklist for revocation\n3. Opaque tokens with introspection\n\nOption 2 gives us the best balance of scalability and revocability.',
              startedAt: Date.now() - 30000,
              durationMs: 28000,
            },
          ]);
        },
      },
      { kind: 'wait', ms: 100 },
      {
        kind: 'call',
        fn: () => {
          const btn = document.querySelector('[data-collapse-id="th1"]') as HTMLElement;
          btn?.click();
        },
      },
    ];
    return <ScriptedChat script={script} height={280} />;
  },
};

const TRANSITION_THINKING_TEXT =
  'Analyzing the codebase...\n\nChecking imports and exports...\n\nFound 3 circular dependencies.\n\nThe fix involves reordering module initialization.';

export const TransitionToDone: Story = {
  render: () => (
    <ScriptedChat
      height={200}
      script={streamThinking({ id: 'th1', text: TRANSITION_THINKING_TEXT, chunkMs: 80 })}
    />
  ),
};

/** Full turn: user prompt → thinking → streamed reply. */
export const ThinkingThenProse: Story = {
  render: () => (
    <ScriptedChat
      height={320}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Optimize this function' }])],
        streamThinking({
          id: 'th1',
          text: 'Looking at the function...\nIt has O(n²) complexity due to nested loops.\nUsing a Map will reduce it to O(n).',
          chunkMs: 80,
        }),
        streamMessage({
          id: 'a1',
          text: 'The bottleneck is the nested loop. Use a `Map` to reduce to **O(n)**.',
          chunkMs: 80,
        })
      )}
    />
  ),
};

/**
 * Expanded thinking with rich markdown: a heading (flattened to body text),
 * bold, inline code, and a fenced code block. Exercises the flattenHeadings +
 * downgradeIslandsToText path and verifies BlockStack renders inside the body.
 */
export const ThinkingExpandedProse: Story = {
  render: () => {
    const script: ScriptStep[] = [
      {
        kind: 'call',
        fn: (api: TranscriptApi) => {
          api.seed([
            {
              kind: 'thinking',
              id: 'th-prose',
              status: 'done',
              text: [
                '## Analysis',
                '',
                'The root issue is that `validateToken()` is called in **three** separate places.',
                'The fix is to consolidate into a single middleware.',
                '',
                '```ts',
                'export function authMiddleware(req, res, next) {',
                '  const token = req.headers.authorization?.split(" ")[1];',
                '  if (!validateToken(token)) return res.status(401).end();',
                '  next();',
                '}',
                '```',
                '',
                'This approach is both **simpler** and easier to audit.',
              ].join('\n'),
              startedAt: Date.now() - 12000,
              durationMs: 11000,
            },
          ]);
        },
      },
      { kind: 'wait', ms: 100 },
      {
        kind: 'call',
        fn: () => {
          const btn = document.querySelector('[data-collapse-id="th-prose"]') as HTMLElement;
          btn?.click();
        },
      },
    ];
    return <ScriptedChat script={script} height={380} />;
  },
};

export const InMixedTranscript: Story = {
  render: () => (
    <ChatHost
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'Explain the deployment pipeline' },
        {
          kind: 'thinking',
          id: 'th1',
          status: 'done',
          text: 'The user wants to understand how we deploy. Let me think through the stages: build → test → staging → production.',
          startedAt: Date.now() - 60000,
          durationMs: 4200,
        },
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'The deployment pipeline has four stages:\n\n1. **Build**: TypeScript compilation + bundling\n2. **Test**: Unit + integration tests in CI\n3. **Staging**: Auto-deploy to staging environment\n4. **Production**: Manual approval gate before release',
        },
      ]}
      height={500}
    />
  ),
};
