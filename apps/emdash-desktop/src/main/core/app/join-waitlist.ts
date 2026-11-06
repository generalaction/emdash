import { env } from '@main/lib/env';

// Same table and message format as the emdash.com/waitlist form, so app signups
// flow through the existing inquiry storage and signup notification pipeline.
const WAITLIST_TABLE = 'cloud_inquiries';
const WAITLIST_MESSAGE_PREFIX = 'Emdash 2.0 waitlist';

export async function joinWaitlist(args: { email: string; message: string }): Promise<void> {
  const url = env.dev.WAITLIST_SUPABASE_URL ?? env.build.VITE_WAITLIST_SUPABASE_URL;
  const anonKey = env.dev.WAITLIST_SUPABASE_ANON_KEY ?? env.build.VITE_WAITLIST_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Waitlist signup is not configured');

  const email = args.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required');

  const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${WAITLIST_TABLE}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      email,
      message: [WAITLIST_MESSAGE_PREFIX, args.message.trim()].filter(Boolean).join('\n\n'),
    }),
  });

  // 409 is a unique violation: the email is already on the list, which the
  // website also treats as a successful signup.
  if (!response.ok && response.status !== 409) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Waitlist signup returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}
