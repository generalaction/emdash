/**
 * Mixed transcript examples — realistic multi-item conversations mixing
 * message, tool, file-op, execute, thinking, and block types.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from '../chat-host';

const meta: Meta = {
  title: 'Examples/MixedTranscript',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

/** Mixed conversation: user prompt → tool calls → assistant reply. */
export const Conversation: Story = {
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

/** Mixed blocks: markdown features combined in one assistant message. */
export const Blocks: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '## Installation\n\nRun the following command:\n\n```bash\nnpm install @emdash/chat-ui\n```\n\nThen import and mount:\n\n```typescript\nimport { mountChat } from "@emdash/chat-ui";\nconst handle = mountChat(container);\n```\n\n> **Note**: The container must have a fixed height for the virtualizer to work correctly.',
        },
      ]}
      height={500}
    />
  ),
};

/** Thinking in a mixed transcript: user → thinking → assistant reply. */
export const Thinking: Story = {
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

/** File operations in a mixed transcript. */
export const FileOps: Story = {
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

/** Execute commands in a mixed transcript. */
export const Execute: Story = {
  render: () => (
    <ChatHost
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'List files and run tests' },
        {
          kind: 'execute',
          id: 'ex6',
          command: 'ls -a',
          status: 'done',
          startedAt: Date.now() - 10000,
          durationMs: 1000,
        },
        {
          kind: 'execute',
          id: 'ex7',
          command: 'pnpm run test',
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
      height={240}
    />
  ),
};
