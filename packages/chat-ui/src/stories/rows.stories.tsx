/**
 * Row-level stories — one transcript item per story for quick style iteration.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from './chat-host';

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
