import { describe, expect, it } from 'vitest';
import { joinWaitlist, WAITLIST_ERROR_MESSAGES } from './join-waitlist';

// Opt-in: runs joinWaitlist against a real waitlist API, such as a local emdash.com
// dev server. Each run records a signup for a new @example.com address.
//
//   EMDASH_TEST_WAITLIST_API_URL=http://localhost:8787/api/waitlist \
//     pnpm --filter @emdash/emdash-desktop test -- --project node join-waitlist.integration
const apiUrl = process.env['EMDASH_TEST_WAITLIST_API_URL'];

describe.skipIf(!apiUrl)('joinWaitlist against a live waitlist API', () => {
  const config = { apiUrl: apiUrl ?? '', source: 'desktop app integration test' };
  const email = `desktop-integration-${Date.now()}@example.com`;

  it('accepts a new signup with a note', async () => {
    await expect(
      joinWaitlist(config, { email, note: 'Sent by the desktop integration test.' })
    ).resolves.toBeUndefined();
  });

  it('accepts the same email again', async () => {
    await expect(
      joinWaitlist(config, { email: email.toUpperCase(), note: 'Second note.' })
    ).resolves.toBeUndefined();
  });

  it('asks the user to check a malformed email address', async () => {
    await expect(joinWaitlist(config, { email: 'not-an-email', note: '' })).rejects.toThrow(
      WAITLIST_ERROR_MESSAGES.invalidEmail
    );
  });
});
