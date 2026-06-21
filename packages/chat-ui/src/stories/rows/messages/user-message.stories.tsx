/**
 * User message row stories.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from '../../_harness/chat-host';

const meta: Meta = {
  title: 'Rows/Messages/User',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

export const Short: Story = {
  render: () => (
    <ChatHost
      items={[{ kind: 'message', id: 'u1', role: 'user', text: 'Hello, can you help me?' }]}
      height={120}
    />
  ),
};

export const Long: Story = {
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

const USER_OVERFLOW_TEXT = [
  'Please refactor the authentication module to use JWT tokens:',
  '',
  '1. Replace the session store with a JWT signing key stored in environment variables.',
  '2. Generate tokens on login with `jsonwebtoken` and validate on each request via middleware.',
  '3. Store refresh tokens in an `httpOnly` cookie with a 7-day expiry.',
  '4. Add rate limiting middleware (100 req/min per IP) to all auth endpoints.',
  '5. Write unit tests for the new middleware covering success, expiry, and tampered-token cases.',
  '6. Update the OpenAPI spec to document the Authorization header.',
  '7. Add a `POST /auth/refresh` endpoint that accepts the refresh token cookie and returns a new access token.',
  '',
  'Make sure backward compatibility is preserved for existing sessions during the migration period.',
].join('\n');

/** User message that overflows the 120px collapsed cap — click to expand to 360px. */
export const Overflowing: Story = {
  render: () => (
    <ChatHost
      items={[{ kind: 'message', id: 'u1', role: 'user', text: USER_OVERFLOW_TEXT }]}
      height={300}
    />
  ),
};
