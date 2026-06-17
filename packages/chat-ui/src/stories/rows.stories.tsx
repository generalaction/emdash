/**
 * Row-level stories — one transcript item per story for quick style iteration.
 */

import { createEffect } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatRoot } from '../ChatRoot';
import { DEFAULT_FONT_CONFIG } from '../core/measure/fonts';
import type { ChatItem } from '../model';
import { createTranscript } from '../state/transcript';
import { createViewState } from '../state/view-state';
import { ChatHost, ScriptedChat } from './chat-host';
import { scenario, seedStep, streamFileOp, streamMessage } from './streaming/scenario';

/**
 * Variant of ChatHost that pre-expands a specific item by id.
 * Used for stories that show the expanded state of collapsible rows.
 */
function ChatHostExpanded(props: { items: ChatItem[]; expandId: string; height: number }) {
  const transcript = createTranscript();
  const viewState = createViewState();

  createEffect(() => {
    transcript.seed(props.items);
  });

  // Pre-toggle so the item starts in the expanded state.
  viewState.toggleCollapsed(props.expandId);

  return (
    <div
      class="overflow-hidden rounded-lg border border-border bg-background"
      style={{ width: '880px', height: `${props.height}px` }}
    >
      <ChatRoot
        transcript={transcript}
        viewState={viewState}
        fonts={DEFAULT_FONT_CONFIG}
        stickToBottom
      />
    </div>
  );
}

const meta: Meta = {
  title: 'ChatUI/Rows',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

export const UserShort: Story = {
  render: () => (
    <ChatHost
      items={[{ kind: 'message', id: 'u1', role: 'user', text: 'Hello, can you help me?' }]}
      height={120}
    />
  ),
};

export const UserLong: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'u1',
          role: 'user',
          text: 'Can you refactor the authentication module to use JWT tokens instead of session cookies, and add rate limiting middleware for the API endpoints?',
        },
      ]}
      height={140}
    />
  ),
};

export const AssistantProse: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'Sure! Here is a breakdown of the key changes needed:\n\n## Authentication\n\nWe will replace the session store with a **JWT signing key** stored in environment variables.\n\n- Generate tokens on login with `jsonwebtoken`\n- Validate on each request via middleware\n- Store refresh tokens in an `httpOnly` cookie',
        },
      ]}
      height={320}
    />
  ),
};

export const AssistantWithCode: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'Here is the middleware:\n\n```typescript\nfunction jwtMiddleware(req: Request, res: Response, next: NextFunction) {\n  const token = req.headers.authorization?.split(" ")[1];\n  if (!token) return res.status(401).json({ error: "Unauthorized" });\n  try {\n    req.user = jwt.verify(token, process.env.JWT_SECRET!);\n    next();\n  } catch {\n    res.status(403).json({ error: "Invalid token" });\n  }\n}\n```',
        },
      ]}
      height={400}
    />
  ),
};

export const AssistantWithTable: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'Comparison of authentication strategies:\n\n| Strategy | Pros | Cons |\n|----------|------|------|\n| JWT | Stateless, scalable | Cannot invalidate |\n| Session | Easy to invalidate | Requires store |\n| OAuth | Delegated auth | Complex setup |',
        },
      ]}
      height={340}
    />
  ),
};

export const ToolRunning: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't1',
          name: 'read_file',
          status: 'running',
          inputSummary: 'src/auth/middleware.ts',
        },
      ]}
      height={80}
    />
  ),
};

export const ToolDone: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't1',
          name: 'write_file',
          status: 'done',
          inputSummary: 'src/auth/jwt.ts',
        },
      ]}
      height={80}
    />
  ),
};

export const ToolError: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't1',
          name: 'run_command',
          status: 'error',
          inputSummary: 'npm test',
          detail: 'Error: ENOENT: no such file or directory',
        },
      ]}
      height={120}
    />
  ),
};

const PROSE_BODY = [
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
].join('');

export const AssistantProseStreaming: Story = {
  render: () => (
    <ScriptedChat
      height={400}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'How does JWT work?' }])],
        streamMessage({ id: 'a1', text: PROSE_BODY, chunkMs: 60 })
      )}
    />
  ),
};

const CODE_BODY = [
  'Here is an example:\n\n',
  '```typescript\n',
  'import jwt from "jsonwebtoken";\n',
  '\nfunction createToken(userId: string): string {\n',
  '  return jwt.sign(\n',
  '    { sub: userId, iat: Date.now() },\n',
  '    process.env.JWT_SECRET!,\n',
  '    { expiresIn: "1h" }\n',
  '  );\n',
  '}\n',
  '```\n\n',
  'Store the secret in your `.env` file.',
].join('');

export const AssistantWithCodeStreaming: Story = {
  render: () => (
    <ScriptedChat
      height={400}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Show me a JWT example' }])],
        streamMessage({ id: 'a1', text: CODE_BODY, chunkMs: 60 })
      )}
    />
  ),
};

export const MixedConversation: Story = {
  render: () => (
    <ChatHost
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'Fix the login bug' },
        {
          kind: 'tool',
          id: 't1',
          name: 'read_file',
          status: 'done',
          inputSummary: 'src/login.ts',
        },
        {
          kind: 'tool',
          id: 't2',
          name: 'write_file',
          status: 'done',
          inputSummary: 'src/login.ts',
        },
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'Fixed! The issue was a missing null check on the `user.session` object. I have added a guard and updated the tests.',
        },
      ]}
      height={340}
    />
  ),
};

// ── File-operation row stories ─────────────────────────────────────────────────

export const FileOpReadSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo1',
          op: 'read',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/model.ts' }],
        },
      ]}
      height={80}
    />
  ),
};

export const FileOpEditSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo2',
          op: 'edit',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/components/tool/Tool.tsx' }],
        },
      ]}
      height={80}
    />
  ),
};

export const FileOpDeleteSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo3',
          op: 'delete',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/old-spec.ts' }],
        },
      ]}
      height={80}
    />
  ),
};

export const FileOpMoveSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo4',
          op: 'move',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/components/tool/GenericTool.tsx' }],
        },
      ]}
      height={80}
    />
  ),
};

export const FileOpMultiCollapsed: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo5',
          op: 'read',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/state/transcript.ts' },
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
          ],
        },
      ]}
      height={80}
    />
  ),
};

export const FileOpMultiExpanded: Story = {
  render: () => (
    <ChatHostExpanded
      items={[
        {
          kind: 'file-op',
          id: 'fo6',
          op: 'read',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/state/transcript.ts' },
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
          ],
        },
      ]}
      expandId="fo6"
      height={180}
    />
  ),
};

export const FileOpMultiRunningPreview: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo7',
          op: 'read',
          status: 'running',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/state/transcript.ts' },
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
          ],
        },
      ]}
      height={160}
    />
  ),
};

export const FileOpEditMultiExpanded: Story = {
  render: () => (
    <ChatHostExpanded
      items={[
        {
          kind: 'file-op',
          id: 'fo8',
          op: 'edit',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/components/row-registry.ts' },
          ],
        },
      ]}
      expandId="fo8"
      height={140}
    />
  ),
};

export const FileOpReadStreaming: Story = {
  render: () => (
    <ScriptedChat
      height={200}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Explore the codebase' }])],
        streamFileOp({
          id: 'fo9',
          op: 'read',
          paths: [
            'packages/chat-ui/src/model.ts',
            'packages/chat-ui/src/state/transcript.ts',
            'packages/chat-ui/src/components/tool/Tool.tsx',
            'packages/chat-ui/src/components/thinking/Thinking.tsx',
            'packages/chat-ui/src/components/row-registry.ts',
          ],
          pathMs: 500,
        })
      )}
    />
  ),
};

export const FileOpMixedConversation: Story = {
  render: () => (
    <ChatHost
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'Refactor the tool renderer' },
        {
          kind: 'file-op',
          id: 'fo10',
          op: 'read',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
            { path: 'packages/chat-ui/src/components/tool/spec.tsx' },
          ],
        },
        {
          kind: 'file-op',
          id: 'fo11',
          op: 'edit',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/components/tool/Tool.tsx' }],
        },
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'Done! I have split `Tool.tsx` into a generic fallback and a dedicated `FileOperation` renderer.',
        },
      ]}
      height={320}
    />
  ),
};

// ── Execute row stories ────────────────────────────────────────────────────────

const LS_OUTPUT = [
  '.',
  '..',
  '.astro',
  '.claude',
  '.env.example',
  '.git',
  '.gitignore',
  '.prettierrc',
  'astro.config.mjs',
  'LICENSE',
  'node_modules',
  'package.json',
  'pnpm-lock.yaml',
  'public',
  'README.md',
  'src',
  'tsconfig.json',
].join('\n');

export const ExecuteRunning: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'execute',
          id: 'ex1',
          command: 'ls -a',
          status: 'running',
          startedAt: Date.now() - 3000,
        },
      ]}
      height={80}
    />
  ),
};

export const ExecuteDone: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'execute',
          id: 'ex2',
          command: 'ls -a',
          output: LS_OUTPUT,
          status: 'done',
          startedAt: Date.now() - 5000,
          durationMs: 5000,
        },
      ]}
      height={80}
    />
  ),
};

export const ExecuteError: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'execute',
          id: 'ex3',
          command: 'pnpm run test',
          output: 'FAIL src/foo.test.ts\n  ✕ should work\n\n1 failed, 0 passed',
          status: 'error',
          startedAt: Date.now() - 8000,
          durationMs: 8000,
        },
      ]}
      height={80}
    />
  ),
};

export const ExecuteExpanded: Story = {
  render: () => (
    <ChatHostExpanded
      items={[
        {
          kind: 'execute',
          id: 'ex4',
          command: 'ls -a',
          output: LS_OUTPUT,
          status: 'done',
          startedAt: Date.now() - 5000,
          durationMs: 5000,
        },
      ]}
      expandId="ex4"
      height={320}
    />
  ),
};

export const ExecuteExpandedLong: Story = {
  render: () => (
    <ChatHostExpanded
      items={[
        {
          kind: 'execute',
          id: 'ex5',
          command: 'find . -name "*.ts"',
          output: Array.from({ length: 30 }, (_, i) => `./src/file${i}.ts`).join('\n'),
          status: 'done',
          startedAt: Date.now() - 2000,
          durationMs: 2000,
        },
      ]}
      expandId="ex5"
      height={360}
    />
  ),
};

export const ExecuteMixedConversation: Story = {
  render: () => (
    <ChatHost
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'List files and run tests' },
        {
          kind: 'execute',
          id: 'ex6',
          command: 'ls -a',
          output: LS_OUTPUT,
          status: 'done',
          startedAt: Date.now() - 10000,
          durationMs: 1000,
        },
        {
          kind: 'execute',
          id: 'ex7',
          command: 'pnpm run test',
          output: '✓ all 42 tests passed',
          status: 'done',
          startedAt: Date.now() - 8000,
          durationMs: 4120,
        },
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: 'All tests passed! The directory listing looks correct.',
        },
      ]}
      height={280}
    />
  ),
};
